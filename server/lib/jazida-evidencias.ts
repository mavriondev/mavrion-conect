/**
 * Catálogo de evidências da jazida — leitura determinística dos dados já
 * persistidos no ativo (módulos do dossiê + pesquisa complementar), separando
 * o que está DENTRO do polígono, no ENTORNO (com distância/raio explícitos),
 * no contexto REGIONAL e em DOCUMENTO vinculado.
 *
 * Regras de certeza:
 * - Nenhum texto livre de IA: todos os enunciados vêm de templates fixos com
 *   fonte, data da consulta e identificador quando houver.
 * - Mesmo conjunto de dados ⇒ mesmo catálogo (sem relógio, ordenação estável).
 * - Proximidade não comprova mineralização; falha de fonte ≠ ausência de
 *   registro; substância requerida ≠ jazida comprovada.
 * - Teores, recursos, reservas e produção só entram como fato quando vêm de
 *   evidência vinculada com unidade (aqui: CFEM para produção; teor/recurso
 *   declarados ficam no score de completude do dossiê, não neste catálogo).
 */
import { montarQuadroCamadas } from "./relatorio-vinculos";
import {
  casaSubstancia, categorizarFase, classificarSubstancia, lacunasDoPerfil, perfilDoGrupo, ROTULO_FASE,
  type FaseCategoria, type GrupoMineral, type LacunaPerfil, type SubstanciaClassificada,
} from "./jazida-perfis";
import { pointInGeom, type FonteResultado, type ResultadoPesquisaComplementar, type VinculoEspacial } from "./pesquisa-complementar";

export type EstadoEvidencia = "registro" | "sem_registro" | "indisponivel" | "nao_consultado";

export interface EvidenciaItem {
  id: string;
  tema: string;
  vinculo: VinculoEspacial;
  titulo: string;
  detalhe: string;
  fonte: string;
  consultadoEm: string | null;
  distanciaKm?: number | null;
  raioKm?: number | null;
  identificador?: string | null;
  mesmaSubstancia?: boolean;
  /** Teor/valor só quando vier com unidade da própria fonte. */
  valor?: { numero: number; unidade: string } | null;
}

export interface FonteEstado {
  id: string;
  label: string;
  estado: EstadoEvidencia;
  consultadoEm: string | null;
  raioKm?: number | null;
  motivo?: string | null;
  cobertura?: string | null;
}

export interface Impeditivo {
  titulo: string;
  detalhe: string;
  fonte: string;
  consultadoEm: string | null;
  severidade: "impeditivo" | "atencao";
}

export interface Divergencia {
  tema: string;
  detalhe: string;
  fontes: string[];
}

export interface LacunaPriorizada extends LacunaPerfil {
  /** Evidência já disponível que atenua parcialmente a lacuna (nunca a fecha). */
  evidenciaParcial?: string | null;
}

export interface CatalogoEvidencias {
  versao: 1;
  perfil: {
    substancia: string;
    grupo: GrupoMineral;
    rotuloGrupo: string;
    termos: string[];
    fase: string | null;
    faseCategoria: FaseCategoria;
    rotuloFase: string;
    prioridades: string[];
    unidadesTeor: string;
  };
  poligono: { disponivel: boolean; raioEquivalenteKm: number | null; pontoReferencia: { lat: number; lon: number } | null };
  itens: EvidenciaItem[];
  fontes: FonteEstado[];
  sintese: {
    porVinculo: Record<VinculoEspacial, number>;
    destaques: string[];
    avisos: string[];
  };
  impeditivos: Impeditivo[];
  divergencias: Divergencia[];
  lacunas: LacunaPriorizada[];
  proximosPassos: string[];
}

const round1 = (v: any): number | null => (v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 10) / 10);
const fmtKm = (v: any): string => (round1(v) == null ? "distância não informada" : `${round1(v)} km`);

const estadoDePayload = (p: any): EstadoEvidencia => {
  if (p == null) return "nao_consultado";
  if (p.disponivel === false) return "indisponivel";
  if (p.estado === "indisponivel") return "indisponivel";
  const total = p.total ?? (Array.isArray(p.data) ? p.data.length : null);
  if (total === 0) return "sem_registro";
  return "registro";
};

const dataConsulta = (c: any, chave: string): string | null =>
  c?.[chave]?.consultadoEm || c?.[`${chave}UpdatedAt`] || null;

function ordenarItens(itens: EvidenciaItem[]): EvidenciaItem[] {
  const peso: Record<VinculoEspacial, number> = { poligono: 0, entorno: 1, regional: 2, documento: 3 };
  return itens.slice().sort((a, b) =>
    peso[a.vinculo] - peso[b.vinculo]
    || Number(!!b.mesmaSubstancia) - Number(!!a.mesmaSubstancia)
    || (a.distanciaKm ?? 9999) - (b.distanciaKm ?? 9999)
    || a.id.localeCompare(b.id));
}

/** Vínculo espacial de um ponto em relação ao polígono do ativo. */
function vinculoDoPonto(
  lat: any, lon: any, distanciaKm: any,
  geometry: any, raioEquivalenteKm: number | null,
): { vinculo: VinculoEspacial; nota: string } {
  const la = Number(lat), lo = Number(lon);
  if (geometry && Number.isFinite(la) && Number.isFinite(lo)) {
    return pointInGeom([lo, la], geometry)
      ? { vinculo: "poligono", nota: "coordenada dentro do polígono do ativo" }
      : { vinculo: "entorno", nota: "coordenada fora do polígono" };
  }
  const d = Number(distanciaKm);
  if (!geometry && raioEquivalenteKm != null && Number.isFinite(d) && d <= raioEquivalenteKm) {
    return { vinculo: "entorno", nota: `a ${fmtKm(d)} do ponto de referência — dentro do raio equivalente à área (${raioEquivalenteKm} km), mas sem polígono para confirmar` };
  }
  return { vinculo: "entorno", nota: Number.isFinite(d) ? `a ${fmtKm(d)} do ponto de referência` : "distância não informada" };
}

export function construirCatalogoEvidencias(asset: any, geometry: any | null): CatalogoEvidencias {
  const c = (asset?.camposEspecificos || {}) as any;
  const attrs = (asset?.attributesJson || {}) as any;
  const substancia = String(c.substancia || attrs.anmSubstancia || "").trim();
  const classe: SubstanciaClassificada = classificarSubstancia(substancia);
  const perfil = perfilDoGrupo(classe.grupo);
  const fase = c.faseAnm || attrs.anmFase || null;
  const faseCategoria = categorizarFase(fase);
  const areaHa = Number(asset?.areaHa);
  const raioEquivalenteKm = Number.isFinite(areaHa) && areaHa > 0 ? Math.round(Math.sqrt((areaHa / 100) / Math.PI) * 100) / 100 : null;
  const lat = c.latitude != null ? Number(c.latitude) : null;
  const lon = c.longitude != null ? Number(c.longitude) : null;
  const pontoReferencia = lat != null && lon != null && Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
  const temPoligono = !!geometry && (geometry.type === "Polygon" || geometry.type === "MultiPolygon");

  const itens: EvidenciaItem[] = [];
  const fontes: FonteEstado[] = [];
  const avisos: string[] = [];
  const divergencias: Divergencia[] = [];
  const pushFonte = (id: string, label: string, payload: any, extra: Partial<FonteEstado> = {}) => {
    fontes.push({ id, label, estado: estadoDePayload(payload), consultadoEm: payload?.consultadoEm || c[`${id}UpdatedAt`] || null, raioKm: payload?.raio_km ?? payload?.raioKm ?? null, motivo: payload?.message || payload?.motivo || null, cobertura: payload?.fonte || null, ...extra });
  };

  // ── Geologia no ponto (1:1M) ──
  const geo = c.anmGeologia;
  pushFonte("anmGeologia", "Litoestratigrafia 1:1.000.000 (GeoSGB)", geo);
  for (const [i, u] of ((geo?.data as any[]) || []).entries()) {
    itens.push({
      id: `geo1m-${i}`, tema: "Geologia", vinculo: temPoligono || pontoReferencia ? "poligono" : "regional",
      titulo: `${u.sigla ? `${u.sigla} — ` : ""}${u.nome || "unidade sem nome"}`,
      detalhe: [u.hierarquia, u.litotipos ? `litotipos: ${u.litotipos}` : null, u.idade ? `idade: ${u.idade}` : null, u.ambiente_tectonico ? `ambiente: ${u.ambiente_tectonico}` : null, "escala 1:1.000.000 — no ponto de referência do ativo"].filter(Boolean).join(" · "),
      fonte: geo.fonte || "GeoSGB/SGB-CPRM", consultadoEm: dataConsulta(c, "anmGeologia"), identificador: u.sigla || null,
    });
  }

  // ── Pesquisa complementar ──
  const pc: ResultadoPesquisaComplementar | null = c.anmPesquisaComplementar || null;
  const fontePc = (id: string): FonteResultado | null => (pc?.fontes as any)?.[id] || null;
  const registrarFontePc = (f: FonteResultado | null, id: string, label: string) => {
    if (!f) { fontes.push({ id: `pc.${id}`, label, estado: "nao_consultado", consultadoEm: null }); return; }
    fontes.push({ id: `pc.${id}`, label: f.label || label, estado: f.estado, consultadoEm: f.consultadoEm, raioKm: f.raioKm ?? null, motivo: f.atualizacaoFalhou ? `última atualização falhou (${f.atualizacaoFalhou.motivo}); exibindo resultado de ${f.consultadoEm}` : f.motivo || null, cobertura: f.cobertura || null });
  };

  const lito = fontePc("litoDetalhada");
  registrarFontePc(lito, "litoDetalhada", "Litoestratigrafia de detalhe (GeoSGB)");
  for (const [i, u] of ((lito?.data?.unidades as any[]) || []).entries()) {
    itens.push({
      id: `litodet-${i}`, tema: "Geologia", vinculo: "poligono",
      titulo: `${u.sigla ? `${u.sigla} — ` : ""}${u.nome || "unidade sem nome"} (${u.escala})`,
      detalhe: [u.hierarquia, u.litotipos ? `litotipos: ${u.litotipos}` : null, u.idade ? `idade: ${u.idade}` : null, u.projeto ? `folha/projeto: ${u.projeto}` : null, "no ponto de referência do ativo"].filter(Boolean).join(" · "),
      fonte: lito!.fonte, consultadoEm: lito!.consultadoEm, identificador: u.sigla || null,
    });
  }

  // ── Ocorrências minerais (GeoSGB) ──
  const rec = c.anmRecursos;
  pushFonte("anmRecursos", "Ocorrências minerais (GeoSGB)", rec);
  const ocorrencias: any[] = Array.isArray(rec?.data) ? rec.data : [];
  let ocorrenciasNoPoligono = 0, ocorrenciasMesmaSubstancia = 0;
  ocorrencias.forEach((o, i) => {
    const v = vinculoDoPonto(o.lat, o.lon, o.distancia_km, temPoligono ? geometry : null, raioEquivalenteKm);
    const mesma = casaSubstancia(o.substancias, classe);
    if (v.vinculo === "poligono") ocorrenciasNoPoligono++;
    if (mesma) ocorrenciasMesmaSubstancia++;
    itens.push({
      id: `ocor-${i}`, tema: "Ocorrência mineral", vinculo: v.vinculo,
      titulo: `${o.nome_ocorrencia || "ocorrência sem nome"} — ${o.substancias || "substância não informada"}`,
      detalhe: [o.status_economico ? `status: ${o.status_economico}` : null, o.importancia ? `importância: ${o.importancia}` : null, o.situacao_mina ? `situação: ${o.situacao_mina}` : null, [o.municipio, o.uf].filter(Boolean).join("/") || null, v.nota, mesma ? "mesma substância do processo" : "substância distinta da requerida"].filter(Boolean).join(" · "),
      fonte: rec.fonte || "GeoSGB/SGB-CPRM", consultadoEm: dataConsulta(c, "anmRecursos"), distanciaKm: round1(o.distancia_km), raioKm: rec?.raio_km ?? null, mesmaSubstancia: mesma,
    });
  });

  // ── Sondagens (GeoSGB) ──
  const sond = c.anmSondagem;
  pushFonte("anmSondagem", "Furos de sondagem históricos (GeoSGB)", sond);
  ((sond?.data as any[]) || []).forEach((s, i) => {
    const v = vinculoDoPonto(s.lat, s.lon, s.distancia_km, temPoligono ? geometry : null, raioEquivalenteKm);
    itens.push({
      id: `sond-${i}`, tema: "Sondagem", vinculo: v.vinculo,
      titulo: `Furo ${s.furo || "N/I"} — ${s.projeto || "projeto N/I"}`,
      detalhe: [s.profundidade_m != null ? `profundidade ${s.profundidade_m} m` : null, s.unidade_estratigrafica ? `unidade: ${s.unidade_estratigrafica}` : null, v.nota, "furo histórico do SGB: indica investigação prévia, não resultado analítico", s.url_rigeo ? `relatório: ${s.url_rigeo}` : null].filter(Boolean).join(" · "),
      fonte: sond.fonte || "GeoSGB/SGB-CPRM", consultadoEm: dataConsulta(c, "anmSondagem"), distanciaKm: round1(s.distancia_km), raioKm: sond?.raio_km ?? null, identificador: s.furo || null,
    });
  });

  // ── Geoquímica (GeoSGB) — só agregado; sem valores analíticos ──
  const geoq = c.anmGeoquimica;
  pushFonte("anmGeoquimica", "Geoquímica — pontos de amostragem (GeoSGB)", geoq);
  if (geoq?.disponivel && geoq.total > 0) {
    const porClasse = Object.entries(geoq.porClasse || {}).sort((a: any, b: any) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).map(([k, v]) => `${k}: ${v}`).join(", ");
    itens.push({
      id: "geoq-resumo", tema: "Geoquímica", vinculo: "entorno",
      titulo: `${geoq.total} ponto(s) de amostragem geoquímica em ${geoq.raio_km} km`,
      detalhe: `${porClasse || "classes não informadas"} · a camada pública informa onde houve amostragem, não os resultados analíticos — valores exigem o relatório do projeto (RIGeo)`,
      fonte: geoq.fonte || "GeoSGB/SGB-CPRM", consultadoEm: dataConsulta(c, "anmGeoquimica"), raioKm: geoq.raio_km ?? null,
    });
  }

  // ── Afloramentos (pesquisa complementar) ──
  const aflo = fontePc("afloramentos");
  registrarFontePc(aflo, "afloramentos", "Afloramentos descritos (GeoSGB)");
  if (aflo?.estado === "registro") {
    const top = (aflo.data?.topRochas || []).slice(0, 5).map((r: any) => `${r.rocha} (${r.total})`).join(", ");
    itens.push({
      id: "aflo-resumo", tema: "Geologia de campo", vinculo: "entorno",
      titulo: `${aflo.total} afloramento(s) descrito(s) em ${aflo.raioKm} km`,
      detalhe: `litologias mais frequentes: ${top || "não informadas"} · descrições de campo do SGB, sem análise química`,
      fonte: aflo.fonte, consultadoEm: aflo.consultadoEm, raioKm: aflo.raioKm ?? null,
    });
    (aflo.data?.pontos || []).slice(0, 8).forEach((a: any, i: number) => {
      const v = vinculoDoPonto(a.lat, a.lon, a.distanciaKm, temPoligono ? geometry : null, raioEquivalenteKm);
      itens.push({
        id: `aflo-${i}`, tema: "Geologia de campo", vinculo: v.vinculo,
        titulo: `Afloramento ${a.numeroCampo || a.id} — ${a.rochas || "litologia não informada"}`,
        detalhe: [a.tipo, a.projeto ? `projeto: ${a.projeto}` : null, a.folha ? `folha ${a.folha}` : null, v.nota].filter(Boolean).join(" · "),
        fonte: aflo.fonte, consultadoEm: aflo.consultadoEm, distanciaKm: round1(a.distanciaKm), identificador: String(a.id ?? a.numeroCampo ?? ""),
      });
    });
  }

  // ── Processos vizinhos (Hub/SIGMINE) ──
  const viz = fontePc("processosVizinhos");
  registrarFontePc(viz, "processosVizinhos", "Processos ANM vizinhos (SIGMINE)");
  if (viz?.estado === "registro") {
    const d = viz.data || {};
    const fases = Object.entries(d.porFase || {}).sort((a: any, b: any) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, 5).map(([k, v]) => `${k}: ${v}`).join(", ");
    itens.push({
      id: "viz-resumo", tema: "Distrito mineral (processos ANM)", vinculo: "entorno",
      titulo: `${viz.total}${viz.truncado ? "+" : ""} processo(s) ANM em ±${viz.raioKm} km; ${d.totalMesmaSubstancia ?? 0} da mesma substância`,
      detalhe: [fases ? `por fase: ${fases}` : null, d.sobrepostosAoPonto ? `${d.sobrepostosAoPonto} polígono(s) de terceiros contêm o ponto de referência` : null, "requerimento vizinho indica interesse exploratório, não mineralização"].filter(Boolean).join(" · "),
      fonte: viz.fonte, consultadoEm: viz.consultadoEm, raioKm: viz.raioKm ?? null,
    });
    (d.processos || []).filter((x: any) => x.mesmaSubstancia).slice(0, 10).forEach((x: any, i: number) => {
      itens.push({
        id: `viz-${i}`, tema: "Distrito mineral (processos ANM)", vinculo: "entorno",
        titulo: `${x.processo} — ${x.substancia} (${x.fase})`,
        detalhe: [x.titular ? `titular: ${x.titular}` : null, x.areaHa != null ? `${x.areaHa} ha` : null, x.ultimoEvento ? `último evento: ${x.ultimoEvento}` : null, `centroide a ${fmtKm(x.distanciaKm)}`].filter(Boolean).join(" · "),
        fonte: viz.fonte, consultadoEm: viz.consultadoEm, distanciaKm: round1(x.distanciaKm), identificador: x.processo, mesmaSubstancia: true,
      });
    });
    if (d.totalMesmaSubstancia === 0 && (viz.total ?? 0) > 0) {
      divergencias.push({ tema: "Substância requerida × distrito", detalhe: `Nenhum dos ${viz.total} processos vizinhos requer ${substancia || "a mesma substância"}; substâncias predominantes: ${(d.topSubstancias || []).slice(0, 3).map((s: any) => s.substancia).join(", ") || "não informadas"}. Isso não nega a mineralização, mas indica ausência de distrito estabelecido para a substância no raio consultado.`, fontes: [viz.fonte] });
    }
  }

  // ── Contexto SGB (bacias/geocronologia) ──
  const sgb = fontePc("sgbContexto");
  registrarFontePc(sgb, "sgbContexto", "Bacias sedimentares e geocronologia (SGB)");
  if (sgb?.estado === "registro") {
    (sgb.data?.bacias || []).forEach((b: any, i: number) => itens.push({
      id: `bacia-${i}`, tema: "Contexto geológico regional", vinculo: "poligono",
      titulo: `Bacia sedimentar: ${b.nome}`, detalhe: [b.tipo, "o ponto de referência está dentro do limite da bacia"].filter(Boolean).join(" · "),
      fonte: sgb.fonte, consultadoEm: sgb.consultadoEm,
    }));
    const g = sgb.data?.geocronologia || [];
    if (g.length) itens.push({
      id: "geocron-resumo", tema: "Contexto geológico regional", vinculo: "regional",
      titulo: `${g.length} datação(ões) geocronológica(s) em ${sgb.raioKm} km`,
      detalhe: g.slice(0, 4).map((x: any) => `${x.amostra || "amostra"}: ${x.rocha || "rocha N/I"} (${x.metodos || "método N/I"}) a ${fmtKm(x.distanciaKm)}`).join("; "),
      fonte: sgb.fonte, consultadoEm: sgb.consultadoEm, raioKm: sgb.raioKm ?? null,
    });
  }

  // ── Documentos técnicos (RIGeo) ──
  const rigeo = fontePc("rigeo");
  registrarFontePc(rigeo, "rigeo", "Documentos técnicos (RIGeo/SGB)");
  ((rigeo?.data?.documentos as any[]) || []).slice(0, 12).forEach((d, i) => itens.push({
    id: `rigeo-${i}`, tema: "Documento técnico", vinculo: "documento",
    titulo: `${d.titulo}${d.ano ? ` (${d.ano})` : ""}`,
    detalhe: [d.tipo, d.editor, d.assuntos?.length ? `assuntos: ${d.assuntos.slice(0, 5).join(", ")}` : null, `busca: "${d.consulta}"`, "casamento documental por título/assunto — conteúdo não verificado", d.url].filter(Boolean).join(" · "),
    fonte: rigeo!.fonte, consultadoEm: rigeo!.consultadoEm, identificador: d.url || d.uuid, mesmaSubstancia: !!d.casaSubstancia,
  }));

  // ── Recursos hídricos (ANA) ──
  const hidr = fontePc("recursosHidricos");
  registrarFontePc(hidr, "recursosHidricos", "Recursos hídricos (ANA/SNIRH)");
  if (hidr?.estado === "registro" || hidr?.estado === "sem_registro") {
    const cursos = hidr.data?.cursosDagua, est = hidr.data?.estacoes, out = hidr.data?.outorgasFederais;
    (cursos?.itens || []).slice(0, 3).forEach((r: any, i: number) => itens.push({
      id: `curso-${i}`, tema: "Recursos hídricos", vinculo: "entorno",
      titulo: `${r.nome} — dominialidade ${r.dominialidade || "N/I"}`,
      detalhe: [r.orgaoGestor ? `órgão gestor da outorga: ${r.orgaoGestor}` : null, r.areaMontanteKm2 != null ? `área a montante ${r.areaMontanteKm2} km²` : null, `a ${fmtKm(r.distanciaKm)}`, "proximidade não comprova disponibilidade hídrica nem outorga"].filter(Boolean).join(" · "),
      fonte: hidr.fonte, consultadoEm: hidr.consultadoEm, distanciaKm: round1(r.distanciaKm), raioKm: cursos?.raioKm ?? 5,
    }));
    if (est?.estado === "registro") {
      const comDados = (est.itens || []).filter((e: any) => /sim/i.test(String(e.possuiDados || "")));
      itens.push({
        id: "est-resumo", tema: "Recursos hídricos", vinculo: "entorno",
        titulo: `${est.total} estação(ões) hidrometeorológica(s) em ${est.raioKm} km (${comDados.length} com dados armazenados)`,
        detalhe: comDados.slice(0, 3).map((e: any) => `${e.nome} (${e.tipo}${e.rio ? `, ${e.rio}` : ""}) a ${fmtKm(e.distanciaKm)}`).join("; ") || "séries disponíveis no HidroWeb/ANA conforme inventário",
        fonte: hidr.fonte, consultadoEm: hidr.consultadoEm, raioKm: est.raioKm ?? 25,
      });
    }
    if (out?.estado === "registro") {
      itens.push({
        id: "out-resumo", tema: "Recursos hídricos", vinculo: "entorno",
        titulo: `${out.total} outorga(s) federal(is) em ${out.raioKm} km`,
        detalhe: (out.itens || []).slice(0, 3).map((o: any) => `${o.nome || o.requerente || "outorga"} — ${o.finalidade || "finalidade N/I"}${o.corpoHidrico ? ` (${o.corpoHidrico})` : ""} a ${fmtKm(o.distanciaKm)}`).join("; ") + " · outorgas estaduais não estão nesta camada",
        fonte: hidr.fonte, consultadoEm: hidr.consultadoEm, raioKm: out.raioKm ?? 25,
      });
    } else if (out?.estado === "sem_registro") {
      itens.push({
        id: "out-resumo", tema: "Recursos hídricos", vinculo: "entorno",
        titulo: `Nenhuma outorga federal em ${out.raioKm} km`,
        detalhe: "vale só para a camada federal da ANA; cursos d'água de dominialidade estadual têm outorgas no órgão estadual, não consultadas aqui",
        fonte: hidr.fonte, consultadoEm: hidr.consultadoEm, raioKm: out.raioKm ?? 25,
      });
    }
  }

  // ── Logística (módulo existente) ──
  const logi = c.anmLogistica;
  pushFonte("anmLogistica", "Infraestrutura logística (INDE/EPE)", logi, { estado: logi ? (logi.disponivel === false ? "indisponivel" : "registro") : "nao_consultado" });
  if (logi?.disponivel) {
    const itensLog: Array<[string, any, string]> = [["Rodovia federal", logi.rodovia, "rodovia próxima não comprova acesso legal nem transitabilidade até o polígono"], ["Ferrovia", logi.ferrovia, "ferrovia próxima não comprova capacidade ou acesso a terminal"], ["Linha de transmissão", logi.linhaTransmissao, "LT próxima não comprova capacidade de conexão"], ["Porto", logi.porto, ""], ["Hidrovia", logi.hidrovia, ""]];
    itensLog.forEach(([label, x, ressalva], i) => {
      if (!x || x.consultado === false) return;
      itens.push({
        id: `logi-${i}`, tema: "Infraestrutura", vinculo: x.encontrado && Number(x.distanciaKm) <= 25 ? "entorno" : "regional",
        titulo: x.encontrado ? `${label}: ${x.nome || ""} a ${fmtKm(x.distanciaKm)}` : `${label}: nenhuma referência em até ${x.raioBuscaKm} km`,
        detalhe: [x.situacao, x.tensaoKv ? `${x.tensaoKv} kV` : null, x.bitola ? `bitola ${x.bitola}` : null, ressalva || null].filter(Boolean).join(" · "),
        fonte: logi.fontes?.[["rodovia", "ferrovia", "linhaTransmissao", "porto", "hidrovia"][i]] || "bases públicas de infraestrutura (INDE/EPE)", consultadoEm: dataConsulta(c, "anmLogistica"), distanciaKm: x.encontrado ? round1(x.distanciaKm) : null, raioKm: x.raioBuscaKm ?? null,
      });
    });
  }

  // ── Produção histórica (CFEM) — único "número" admitido, com unidade R$ ──
  const cfem = c.anmCfem;
  pushFonte("anmCfem", "CFEM — arrecadação (dados abertos ANM)", cfem);
  if (cfem?.disponivel && cfem.processo) {
    const total = Number(cfem.processo.totalRecolhido || 0);
    itens.push({
      id: "cfem-processo", tema: "Produção histórica", vinculo: "documento",
      titulo: cfem.processo.jaProduziu ? `Processo com recolhimento de CFEM: R$ ${total.toLocaleString("pt-BR")}` : "Processo sem recolhimento de CFEM na base coberta",
      detalhe: cfem.processo.jaProduziu ? `anos com recolhimento: ${(cfem.processo.porAno || []).map((a: any) => a.ano).join(", ")} · recolhimento = produção comercializada` : "sem produção comercializada registrada no período coberto pela base (não vale fora da janela)",
      fonte: "CFEM/ANM (dados abertos)", consultadoEm: dataConsulta(c, "anmCfem"), identificador: c.processoAnm || null,
      valor: cfem.processo.jaProduziu ? { numero: total, unidade: "R$ (CFEM recolhida)" } : null,
    });
    if (cfem.processo.jaProduziu && ["requerimento_pesquisa", "autorizacao_pesquisa"].includes(faseCategoria)) {
      divergencias.push({ tema: "Fase × produção", detalhe: `O processo está em ${ROTULO_FASE[faseCategoria].toLowerCase()} mas tem CFEM recolhida — verificar guia de utilização, fase anterior ou vínculo do recolhimento ao número do processo.`, fontes: ["CFEM/ANM (dados abertos)", "Cadastro Mineiro/SIGMINE"] });
    }
  }

  // ── Documentos do processo (SEI) ──
  const sei = c.anmSei;
  pushFonte("anmSei", "SEI/ANM — documentos do processo", sei, { estado: sei ? (sei.estadoConsulta === "consultada_sem_registro" ? "sem_registro" : "registro") : "nao_consultado" });
  const docsSei: any[] = Array.isArray(sei?.documentos) ? sei.documentos : [];
  const docsTecnicos = docsSei.filter((d) => /relat[oó]rio\s+final|pae|plano de aproveitamento|relat[oó]rio\s+anual|rfp|sondagem|an[aá]lise|laudo/i.test(`${d?.tipo || ""} ${d?.numero || ""} ${d?.descricao || ""}`));
  docsTecnicos.slice(0, 8).forEach((d, i) => itens.push({
    id: `sei-${i}`, tema: "Documento do processo", vinculo: "documento",
    titulo: `${d.tipo || "documento"}${d.numero ? ` nº ${d.numero}` : ""}`,
    detalhe: [d.data ? `data ${d.data}` : null, d.unidade || null, "documento listado na pesquisa pública do SEI — conteúdo não lido; valores técnicos exigem cópia e revisão com página e unidade"].filter(Boolean).join(" · "),
    fonte: "SEI/ANM (pesquisa pública)", consultadoEm: dataConsulta(c, "anmSei"), identificador: d.numero || null,
  }));

  // ── Impeditivos documentados (restrições/FUNAI) ──
  const impeditivos: Impeditivo[] = [];
  if (c.anmRestricoes || c.anmFunai || c.anmFunaiTerras) {
    const quadro = montarQuadroCamadas(c);
    for (const l of quadro.linhas) {
      if (!l.consultada) continue;
      if (/SOBREPOSI/i.test(l.status)) {
        impeditivos.push({ titulo: `${l.label}: sobreposição direta`, detalhe: l.destaque || "polígono do ativo sobrepõe a camada", fonte: `${l.label} (camada oficial)`, consultadoEm: dataConsulta(c, "anmRestricoes") || dataConsulta(c, "anmFunai"), severidade: "impeditivo" });
      } else if (/ocorr[êe]ncia\(s\) no raio/i.test(l.status)) {
        impeditivos.push({ titulo: `${l.label}: ${l.status}`, detalhe: l.destaque || "ocorrência no raio consultado — não há sobreposição direta registrada", fonte: `${l.label} (camada oficial)`, consultadoEm: dataConsulta(c, "anmRestricoes") || dataConsulta(c, "anmFunai"), severidade: "atencao" });
      }
    }
    pushFonte("anmRestricoes", "Camadas de restrição (FUNAI, UC, embargos, cavernas, quilombolas, assentamentos)", c.anmRestricoes || c.anmFunai, { estado: "registro" });
  } else {
    fontes.push({ id: "anmRestricoes", label: "Camadas de restrição (FUNAI, UC, embargos, cavernas, quilombolas, assentamentos)", estado: "nao_consultado", consultadoEm: null });
  }
  impeditivos.sort((a, b) => (a.severidade === b.severidade ? a.titulo.localeCompare(b.titulo) : a.severidade === "impeditivo" ? -1 : 1));

  // ── Divergência: substância requerida × ocorrências catalogadas ──
  if (ocorrencias.length > 0 && ocorrenciasMesmaSubstancia === 0 && classe.termos.length) {
    divergencias.push({ tema: "Substância requerida × ocorrências GeoSGB", detalhe: `Nenhuma das ${ocorrencias.length} ocorrências catalogadas em ${rec?.raio_km ?? "?"} km é de ${substancia}. Não nega a mineralização (o cadastro do SGB é incompleto), mas a substância requerida não conta com ocorrência pública conhecida no raio.`, fontes: [rec?.fonte || "GeoSGB/SGB-CPRM"] });
  }
  divergencias.sort((a, b) => a.tema.localeCompare(b.tema));

  // ── Avisos fixos de leitura ──
  if (!temPoligono) avisos.push("Polígono do ativo indisponível: a separação dentro/fora usa o ponto de referência e o raio equivalente à área declarada; confirme com o polígono SIGMINE.");
  if (!pontoReferencia) avisos.push("Ativo sem coordenadas: consultas espaciais não foram possíveis — informe latitude/longitude ou vincule o processo ANM.");
  avisos.push("Substância requerida na ANM não significa jazida comprovada: ocorrência, recurso e reserva são categorias distintas e só a última admite avaliação econômica.");
  avisos.push("Proximidade de ocorrência, sondagem, água, energia ou rodovia não comprova mineralização, disponibilidade, outorga, conexão nem acesso legal.");

  // ── Lacunas prioritárias por perfil, com evidência parcial quando houver ──
  const evidenciaParcialPorLacuna: Record<string, string | null> = {
    teor_metodo: docsTecnicos.length ? `${docsTecnicos.length} documento(s) técnico(s) listado(s) no SEI podem conter os valores — exigem cópia e revisão` : null,
    mineralogia: (rigeo?.data?.documentos || []).some((d: any) => d.casaSubstancia) ? "documentos do RIGeo sobre a substância na região podem trazer analogias (não substituem caracterização do alvo)" : null,
    infra_agua_energia: hidr?.estado === "registro" ? "curso d'água, órgão gestor e estações identificados — falta a confirmação de outorga/conexão" : (logi?.disponivel ? "infraestrutura regional mapeada — falta confirmação de acesso/conexão" : null),
    mercado_local: viz?.estado === "registro" ? `${viz.data?.totalMesmaSubstancia ?? 0} processo(s) vizinho(s) da mesma substância indicam concorrentes/atividade no raio` : null,
    mercado_regional: viz?.estado === "registro" ? `${viz.data?.totalMesmaSubstancia ?? 0} processo(s) vizinho(s) da mesma substância indicam atividade no raio` : null,
    passivo_garimpo: viz?.estado === "registro" && Object.keys(viz.data?.porFase || {}).some((f) => /garimp/i.test(f)) ? "há processos de lavra garimpeira no raio consultado" : null,
  };
  const lacunas: LacunaPriorizada[] = lacunasDoPerfil(classe.grupo, faseCategoria).map((l) => ({ ...l, evidenciaParcial: evidenciaParcialPorLacuna[l.id] ?? null }));

  // ── Próximos passos: fontes não consultadas/indisponíveis + lacunas P1 ──
  const proximosPassos: string[] = [];
  const naoConsultadas = fontes.filter((f) => f.estado === "nao_consultado").map((f) => f.label);
  if (naoConsultadas.length) proximosPassos.push(`Executar as consultas ainda não realizadas: ${naoConsultadas.join("; ")}.`);
  const indisp = fontes.filter((f) => f.estado === "indisponivel").map((f) => f.label);
  if (indisp.length) proximosPassos.push(`Repetir as fontes indisponíveis nesta rodada (falha não é ausência de registro): ${indisp.join("; ")}.`);
  for (const l of lacunas.filter((x) => x.prioridade === 1)) proximosPassos.push(`${l.tema}: ${l.proximoPasso}.`);
  if (impeditivos.some((i) => i.severidade === "impeditivo")) proximosPassos.push("Tratar as sobreposições diretas documentadas antes de qualquer avaliação econômica (consulta ao órgão da camada e ao titular).");
  if (!temPoligono) proximosPassos.push("Obter o polígono do processo (SIGMINE) para confirmar o que está dentro e fora da área.");

  const itensOrdenados = ordenarItens(itens);
  const porVinculo: Record<VinculoEspacial, number> = { poligono: 0, entorno: 0, regional: 0, documento: 0 };
  for (const it of itensOrdenados) porVinculo[it.vinculo]++;

  const destaques: string[] = [];
  if (ocorrenciasNoPoligono > 0) destaques.push(`${ocorrenciasNoPoligono} ocorrência(s) mineral(is) catalogada(s) dentro do polígono (GeoSGB).`);
  if (ocorrenciasMesmaSubstancia > 0) destaques.push(`${ocorrenciasMesmaSubstancia} ocorrência(s) da mesma substância em ${rec?.raio_km ?? "?"} km.`);
  if (sond?.disponivel && sond.total > 0) destaques.push(`${sond.total} furo(s) histórico(s) do SGB em ${sond.raio_km} km — investigação prévia, sem resultado analítico público.`);
  if (viz?.estado === "registro") destaques.push(`${viz.data?.totalMesmaSubstancia ?? 0} processo(s) ANM vizinho(s) da mesma substância em ±${viz.raioKm} km.`);
  if (rigeo?.estado === "registro") destaques.push(`${rigeo.total} documento(s) técnico(s) do SGB casados por título/assunto (RIGeo).`);
  if (cfem?.disponivel && cfem.processo?.jaProduziu) destaques.push("Processo com produção comercializada registrada (CFEM).");
  if (impeditivos.length) destaques.push(`${impeditivos.filter((i) => i.severidade === "impeditivo").length} sobreposição(ões) direta(s) e ${impeditivos.filter((i) => i.severidade === "atencao").length} ocorrência(s) de restrição no raio.`);

  return {
    versao: 1,
    perfil: {
      substancia, grupo: classe.grupo, rotuloGrupo: perfil.rotulo, termos: classe.termos,
      fase: fase ? String(fase) : null, faseCategoria, rotuloFase: ROTULO_FASE[faseCategoria],
      prioridades: perfil.prioridades, unidadesTeor: perfil.unidadesTeor,
    },
    poligono: { disponivel: temPoligono, raioEquivalenteKm, pontoReferencia },
    itens: itensOrdenados,
    fontes,
    sintese: { porVinculo, destaques, avisos },
    impeditivos,
    divergencias,
    lacunas,
    proximosPassos,
  };
}

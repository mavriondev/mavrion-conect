// Verificações de uma terra: sobreposições, uso do solo, alertas, NDVI, logística e APP estimada.
// Cada resultado sai no modelo de confiança (confianca-dados.ts): "indicado por fonte" ou "sem dado",
// nunca "confirmado" (isso só vem de ação humana) e nunca "não existe" quando a consulta falhou.
//
// Persistência em asset_verificacoes é APPEND-ONLY (histórico): cada execução grava linhas novas.

import { db } from "../db";
import { sql } from "drizzle-orm";
import { utmSridSqlExpr } from "./utm";
import { consultarSobreposicoes, computePostGISIntersection } from "./due-diligence-fundiaria";
import type { SobreposicaoArea } from "./due-diligence-fundiaria";
import { getUsoTerraMapBiomas, classesDeUsoNosPontos } from "./mapbiomas";
import { amostrarInterior } from "./geo-medicao";
import { resumirUsoSolo, descreverUsoSolo } from "./uso-solo-amostragem";
import { extensaoCamadaWfs, caixaDentroDaExtensao } from "./wfs-descoberta";
import { descreverFonteWfs } from "./restricoes-wfs";
import { getNDVISentinel } from "./sentinel";
import { verificacaoAutomatica, type Verificacao } from "./confianca-dados";
import { IBGE_WFS, consultarWfsIbge, verificarMalha } from "./logistica-ibge";

export interface AtivoGeo {
  id: number;
  geojson: any;
  bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number };
  lat: number;
  lon: number;
  carCodImovel: string | null;
}

export async function carregarAtivoGeo(assetId: number, orgId: number): Promise<AtivoGeo | null> {
  const rows = await db.execute(sql`
    SELECT ST_AsGeoJSON(geom) AS gj,
           ST_XMin(geom) AS xmin, ST_YMin(geom) AS ymin, ST_XMax(geom) AS xmax, ST_YMax(geom) AS ymax,
           ST_X(ST_PointOnSurface(geom)) AS lon, ST_Y(ST_PointOnSurface(geom)) AS lat,
           car_cod_imovel
      FROM assets
     WHERE id = ${assetId} AND org_id = ${orgId} AND geom IS NOT NULL
  `);
  const r = (rows as any).rows?.[0];
  if (!r?.gj) return null;
  return {
    id: assetId,
    geojson: JSON.parse(r.gj),
    bbox: { minLon: Number(r.xmin), minLat: Number(r.ymin), maxLon: Number(r.xmax), maxLat: Number(r.ymax) },
    lat: Number(r.lat),
    lon: Number(r.lon),
    carCodImovel: r.car_cod_imovel || null,
  };
}

function indeterminada(chave: string, fonte: string, observacao?: string): Verificacao {
  return verificacaoAutomatica({ chave, achado: "indeterminado", fonte, observacao });
}

// ---------- sobreposições ----------
export async function verificarSobreposicoes(a: AtivoGeo, opts: { usarCache?: boolean } = {}): Promise<Verificacao[]> {
  const FONTE = "FUNAI/CMR, IBGE/INCRA e MMA/CNUC/INDE (WFS) + interseção PostGIS";
  const chaves = {
    terraIndigena: "sobreposicao_ti",
    quilombola: "sobreposicao_quilombola",
    unidadeConservacao: "sobreposicao_uc",
    assentamento: "sobreposicao_assentamento",
  } as const;

  let res: Awaited<ReturnType<typeof consultarSobreposicoes>> = null;
  try {
    res = await consultarSobreposicoes(a.lat, a.lon, null, 0.15, a.bbox, opts);
  } catch { res = null; }
  if (!res) return Object.values(chaves).map((c) => indeterminada(c, FONTE, "Consulta não respondeu."));

  const listas: Record<keyof typeof chaves, SobreposicaoArea[]> = {
    terraIndigena: res.terrasIndigenas,
    quilombola: res.quilombolas,
    unidadeConservacao: res.unidadesConservacao,
    assentamento: res.assentamentos || [],
  };
  const feats = res.geoJsonFeatures || [];
  const out: Verificacao[] = [];

  for (const k of Object.keys(chaves) as Array<keyof typeof chaves>) {
    const status = res.camadas?.[k];
    const evidencia = k === "assentamento" ? undefined : res.evidencias?.[k];
    const fonte = evidencia ? `${descreverFonteWfs(evidencia)} + interseção PostGIS` : FONTE;
    const limite = evidencia ? `Consulta: ${evidencia.consultadoEm}. ${evidencia.limitacoes}` : "";
    if (!status || status === "falhou") {
      out.push(indeterminada(chaves[k], fonte, `Camada indisponível ou incompleta — não é ausência de sobreposição. ${evidencia?.erro || ""} ${limite}`.trim()));
      continue;
    }
    if (status === "nao_configurada") { out.push(indeterminada(chaves[k], FONTE, "Camada não configurada (INCRA_ASSENTAMENTOS_WFS_LAYER).")); continue; }

    const achadas: Array<{ nome: string; categoria?: string; pct: number; ha: number; aVerificar?: string }> = [];
    let proximas = 0;
    for (const area of listas[k]) {
      const feat = feats.find((f: any) => f?.properties?.featKey === area.featKey);
      if (!feat?.geometry) { achadas.push({ nome: area.nome, categoria: area.categoria, pct: 0, ha: 0, aVerificar: "geometria indisponível" }); continue; }
      try {
        const r = await computePostGISIntersection(a.id, feat.geometry, a.geojson);
        if (r.aVerificar) achadas.push({ nome: area.nome, categoria: area.categoria, pct: 0, ha: 0, aVerificar: r.aVerificar });
        else if (r.intersectionAreaHa > 0) achadas.push({ nome: area.nome, categoria: area.categoria, pct: r.overlapPercent, ha: r.intersectionAreaHa });
        else proximas++;
      } catch {
        achadas.push({ nome: area.nome, categoria: area.categoria, pct: 0, ha: 0, aVerificar: "cálculo de interseção falhou" });
      }
    }
    out.push(verificacaoAutomatica({
      chave: chaves[k],
      achado: achadas.length > 0 ? "detectado" : "nao_detectado",
      valor: achadas.length > 0 ? achadas : null,
      fonte,
      observacao: [limite, proximas > 0 ? `${proximas} feição(ões) na vizinhança sem interseção com o polígono.` : ""].filter(Boolean).join(" ") || undefined,
    }));
  }
  return out;
}

// ---------- MapBiomas (uso do solo e alertas) ----------
export async function verificarMapBiomas(a: AtivoGeo, fontes = {
  getUsoTerraMapBiomas, classesDeUsoNosPontos,
}): Promise<Verificacao[]> {
  const FONTE = "MapBiomas (cobertura e alertas)";
  let mb: Awaited<ReturnType<typeof getUsoTerraMapBiomas>> = null;
  try { mb = await fontes.getUsoTerraMapBiomas(a.lat, a.lon, a.carCodImovel || undefined); } catch { mb = null; }
  if (!mb) {
    return [
      indeterminada("uso_solo", FONTE, "Sem resposta do MapBiomas (credenciais ausentes ou serviço indisponível)."),
      indeterminada("alertas_desmatamento", FONTE, "Sem resposta do MapBiomas."),
    ];
  }
  const out: Verificacao[] = [];

  const ultimo = mb.historico?.length ? mb.historico[mb.historico.length - 1] : null;
  // Proporção por amostragem de 16 pontos internos; se não houver amostra suficiente, cai para a classe do ponto central.
  let usoAmostrado: ReturnType<typeof resumirUsoSolo> = null;
  let anoAmostra: number | null = null;
  try {
    const pts = amostrarInterior(a.geojson, 16);
    const amostra = pts.length >= 4 ? await fontes.classesDeUsoNosPontos(pts) : null;
    if (amostra) { usoAmostrado = resumirUsoSolo(amostra.classes); anoAmostra = amostra.ano; }
  } catch { usoAmostrado = null; }
  if (usoAmostrado) {
    out.push(verificacaoAutomatica({
      chave: "uso_solo", achado: "detectado",
      valor: { ...usoAmostrado, amostras: usoAmostrado.amostrasValidas, ano: anoAmostra, descricao: descreverUsoSolo(usoAmostrado) },
      fonte: FONTE,
      observacao: `Estimativa por amostragem de ${usoAmostrado.amostrasTotal} pontos dentro do polígono${anoAmostra ? ` (ano ${anoAmostra})` : ""}: ${usoAmostrado.amostrasValidas} classificados e ${usoAmostrado.amostrasSemDado} sem dado. Proporções sobre todos os pontos, arredondadas em conjunto em faixas de 5 pontos percentuais (total 100%, incluindo sem dado). Não é área medida nem medição por pixel; a amostra não permite afirmar margem de erro estatística.`,
    }));
  } else out.push(
    mb.usoAtual && mb.usoAtual !== "Não identificado"
      ? verificacaoAutomatica({
          chave: "uso_solo", achado: "detectado", valor: mb.usoAtual, fonte: FONTE,
          observacao: `Amostra insuficiente ou indisponível para estimar proporções. Classe no ponto central (pixel de ~30 m)${ultimo ? `, ano ${ultimo.ano}` : ""} — não é a proporção de cada uso na área.`,
        })
      : indeterminada("uso_solo", FONTE, "Classe de uso não identificada no ponto."),
  );

  if (!mb.alertasConsultados) {
    out.push(indeterminada("alertas_desmatamento", FONTE, "Consulta de alertas não respondeu — não é ausência de alertas."));
  } else {
    out.push(verificacaoAutomatica({
      chave: "alertas_desmatamento",
      achado: mb.alertasDesmatamento > 0 ? "detectado" : "nao_detectado",
      valor: mb.alertasDesmatamento > 0 ? { alertas: mb.alertasDesmatamento, areaHa: mb.areaDesmatadaHa, escopo: mb.alertasEscopo } : null,
      fonte: FONTE,
      observacao: mb.alertasEscopo === "regiao" ? "Alertas numa caixa de ~4 km ao redor do ponto (podem ser de vizinhos); informe o CAR para filtrar." : undefined,
    }));
  }

  return out;
}

// ---------- NDVI ----------
async function verificarNdvi(a: AtivoGeo): Promise<Verificacao> {
  const FONTE = "Sentinel-2 L2A / Copernicus";
  const g = a.geojson?.geometry || a.geojson;
  let anel: number[][][] | null = null;
  if (g?.type === "Polygon") anel = g.coordinates;
  else if (g?.type === "MultiPolygon" && g.coordinates?.[0]) anel = g.coordinates[0]; // só para o bbox; a estatística usa a geometria inteira
  let r: Awaited<ReturnType<typeof getNDVISentinel>> = null;
  try { r = await getNDVISentinel(a.lat, a.lon, anel, g?.type === "MultiPolygon" ? g : undefined); } catch { r = null; }
  if (!r) return indeterminada("ndvi", FONTE, "Sem imagem válida (credenciais ausentes, nuvem ou serviço indisponível).");
  return verificacaoAutomatica({
    chave: "ndvi", achado: "detectado", valor: r.ndvi, fonte: r.fonte,
    consultadoEm: new Date().toISOString(),
    observacao: `Composto de ${r.periodoInicio} a ${r.periodoFim}. ${r.classificacao}. NDVI indica vigor da vegetação, não produtividade nem uso agrícola.` +
      "",
  });
}

// ---------- logística ----------
// Rodovia/ferrovia pela BC250 2025 nacional, com controle positivo e checagem de cobertura (logistica-ibge.ts).
async function verificarLogistica(a: AtivoGeo): Promise<Verificacao[]> {
  const out: Verificacao[] = [];
  for (const malha of ["rodovia", "ferrovia"] as const) {
    try { out.push(await verificarMalha(a, malha)); }
    catch (err) { out.push(indeterminada(`logistica_${malha}`, "IBGE BC250 2025", `Consulta falhou: ${(err as Error).message}`)); }
  }
  return out;
}

// ---------- APP mínima estimada ----------
async function verificarApp(a: AtivoGeo): Promise<Verificacao> {
  const FONTE = "IBGE BC100 (drenagem) + PostGIS";
  const CAMADA = "CCAR:BC100_Trecho_Drenagem_L";
  const w = await consultarWfsIbge(CAMADA, a.bbox);
  if (!w.ok) return indeterminada("app_estimada", FONTE, "Camada de drenagem não respondeu.");
  const geoms = w.features.map((f: any) => f?.geometry).filter((g: any) => g && (g.type === "LineString" || g.type === "MultiLineString"));
  const aviso = "Mínimo: faixa de 30 m de cada lado dos cursos d'água mapeados (escala 1:100.000). Não inclui nascentes, rios largos, lagos, topo de morro nem declives; a APP real vem do CAR/levantamento.";
  if (geoms.length === 0) {
    // A camada BC100 genérica de drenagem só cobre o Centro-Oeste; fora da extensão publicada, vazio = sem cobertura.
    const extensao = await extensaoCamadaWfs(IBGE_WFS, CAMADA);
    if (!extensao) return indeterminada("app_estimada", FONTE, "Nenhum curso d'água devolvido e extensão da camada desconhecida — não dá para distinguir ausência de falta de cobertura.");
    if (!caixaDentroDaExtensao(a.bbox, extensao)) {
      return indeterminada("app_estimada", FONTE, `Imóvel fora da extensão publicada da camada de drenagem BC100 (lon ${extensao.minLon.toFixed(1)}..${extensao.maxLon.toFixed(1)}, lat ${extensao.minLat.toFixed(1)}..${extensao.maxLat.toFixed(1)}) — sem cobertura, não ausência de cursos d'água.`);
    }
    return verificacaoAutomatica({ chave: "app_estimada", achado: "nao_detectado", fonte: FONTE, observacao: "Nenhum curso d'água mapeado na propriedade (camada cobre a área)." });
  }
  try {
    const rows = await db.execute(sql`
      WITH prop AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(a.geojson)}), 4326) AS g),
      srid AS (SELECT ${sql.raw(utmSridSqlExpr("(SELECT g FROM prop)"))} AS s),
      linhas AS (
        SELECT ST_Union(ST_Transform(l.g, (SELECT s FROM srid))) AS g
          FROM (
            SELECT ST_SetSRID(ST_GeomFromGeoJSON(t.e::text), 4326) AS g
              FROM jsonb_array_elements(${JSON.stringify(geoms)}::jsonb) AS t(e)
          ) l
         WHERE ST_Intersects(l.g, (SELECT g FROM prop))
      )
      SELECT ROUND(CAST(ST_Area(ST_Transform((SELECT g FROM prop), (SELECT s FROM srid))) / 10000 AS numeric), 2) AS area_ha,
             ROUND(CAST(COALESCE(ST_Area(ST_Intersection(
               ST_Buffer((SELECT g FROM linhas), 30),
               ST_Transform((SELECT g FROM prop), (SELECT s FROM srid))
             )), 0) / 10000 AS numeric), 2) AS app_ha
    `);
    const r = (rows as any).rows?.[0];
    const areaHa = Number(r?.area_ha) || 0;
    const appHa = Number(r?.app_ha) || 0;
    if (!areaHa) return indeterminada("app_estimada", FONTE, "Não foi possível calcular a área do imóvel.");
    if (appHa <= 0) return verificacaoAutomatica({ chave: "app_estimada", achado: "nao_detectado", fonte: FONTE, observacao: "Nenhum curso d'água mapeado cruza o polígono." });
    return verificacaoAutomatica({
      chave: "app_estimada", achado: "detectado",
      valor: { appHa, pctDaArea: Math.round((appHa / areaHa) * 1000) / 10 }, unidade: "ha",
      fonte: FONTE, observacao: aviso + (w.truncado ? " Limite de feições atingido — pode estar subestimada." : ""),
    });
  } catch (err) {
    return indeterminada("app_estimada", FONTE, `Cálculo falhou: ${(err as Error).message}`);
  }
}

// ---------- orquestração ----------
export async function executarVerificacoes(a: AtivoGeo): Promise<Verificacao[]> {
  // Em paralelo, mas cada bloco isolado: a falha de um não derruba os outros.
  const seguro = async <T>(fn: () => Promise<T>, vazio: T): Promise<T> => { try { return await fn(); } catch { return vazio; } };
  const [sobre, mb, ndvi, logi, app] = await Promise.all([
    seguro(() => verificarSobreposicoes(a), [] as Verificacao[]),
    seguro(() => verificarMapBiomas(a), [] as Verificacao[]),
    seguro(() => verificarNdvi(a), indeterminada("ndvi", "Sentinel-2")),
    seguro(() => verificarLogistica(a), [] as Verificacao[]),
    seguro(() => verificarApp(a), indeterminada("app_estimada", "IBGE BC100")),
  ]);
  return [...sobre, ...mb, ndvi, ...logi, app];
}

export async function gravarVerificacoes(assetId: number, orgId: number, vs: Verificacao[]): Promise<void> {
  for (const v of vs) {
    await db.execute(sql`
      INSERT INTO asset_verificacoes
        (asset_id, org_id, chave, estado, achado, rotulo, valor_json, unidade, fonte, observacao, confirmado_por, consultado_em)
      VALUES
        (${assetId}, ${orgId}, ${v.chave}, ${v.estado}, ${v.achado}, ${v.rotulo},
         ${JSON.stringify(v.valor ?? null)}::jsonb, ${v.unidade ?? null}, ${v.fonte}, ${v.observacao ?? null},
         ${v.confirmadoPor ?? null}, ${v.consultadoEm}::timestamp)
    `);
  }
}

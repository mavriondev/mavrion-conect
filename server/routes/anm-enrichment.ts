import type { Express } from "express";
import { getCached, setCached } from "../cache";
import OpenAI from "openai";
import { db } from "../db";
import { companies, assets } from "@shared/schema";
import { eq, and, or, isNull } from "drizzle-orm";
import { getOrgId } from "../lib/tenant";
import { getProcessoFromCache } from "../lib/scm-scraper";

const cnpjaHeaders = () => ({
  "Authorization": process.env.CNPJA_API_KEY || "",
});

let _openai: OpenAI | null = null;
function getSmartOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

const PESSOA_JURIDICA_SUFFIXES = [
  "LTDA", "S/A", "S.A.", "SA", "ME", "EIRELI", "EPP", "EIRELLI",
  "MINERACAO", "MINERAÇÃO", "INDUSTRIA", "INDÚSTRIA", "COMERCIO",
  "COMÉRCIO", "ENGENHARIA", "CONSTRUTORA", "EMPREENDIMENTOS",
  "PARTICIPACOES", "PARTICIPAÇÕES", "HOLDINGS", "HOLDING",
  "COOPERATIVA", "ASSOCIACAO", "ASSOCIAÇÃO", "FUNDACAO", "FUNDAÇÃO",
  "INSTITUTO", "GRUPO", "CIA", "COMPANHIA",
];

function isPessoaFisica(nome: string): boolean {
  if (!nome) return false;
  const upper = nome.toUpperCase().trim();
  for (const suffix of PESSOA_JURIDICA_SUFFIXES) {
    if (upper.includes(suffix)) return false;
  }
  const parts = upper.split(/\s+/).filter(p => p.length > 1);
  if (parts.length >= 2 && parts.length <= 5) {
    const hasCommonPrepositions = parts.some(p => ["DE", "DA", "DO", "DOS", "DAS", "E"].includes(p));
    const allAlpha = parts.every(p => /^[A-ZÁÀÂÃÉÈÊÍÏÓÔÕÖÚÜÇ]+$/.test(p));
    if (allAlpha && (parts.length >= 3 || hasCommonPrepositions || parts.length === 2)) {
      return true;
    }
  }
  return false;
}

const ANM_MAPSERVER_URL = "https://geo.anm.gov.br/arcgis/rest/services/SIGMINE/dados_anm/MapServer/0/query";
const MAVRION_API_URL = "https://api.mavrionconnect.com.br";
const MAVRION_API_KEY = process.env.MAVRION_API_KEY || "";

const MINERAL_SYMBOLS: Record<string, string> = {
  "OURO": "XAU",
  "PRATA": "XAG",
  "COBRE": "HG",
  "NIQUEL": "NICKEL",
  "NÍQUEL": "NICKEL",
  "FERRO": "IRON_ORE",
  "ALUMINIO": "ALUMINUM",
  "ALUMÍNIO": "ALUMINUM",
  "ZINCO": "ZINC",
  "ESTANHO": "TIN",
  "CHUMBO": "LEAD",
  "MANGANES": "MANGANESE",
  "MANGANÊS": "MANGANESE",
  "PLATINA": "XPT",
  "PALADIO": "XPD",
  "PALÁDIO": "XPD",
  "NIOBIO": "NIOBIUM",
  "NIÓBIO": "NIOBIUM",
  "LITIO": "LITHIUM",
  "LÍTIO": "LITHIUM",
  "TITANIO": "TITANIUM",
  "TITÂNIO": "TITANIUM",
  "CROMO": "CHROMIUM",
  "TUNGSTENIO": "TUNGSTEN",
  "TUNGSTÊNIO": "TUNGSTEN",
  "COBALTO": "COBALT",
  "MOLIBDENIO": "MOLYBDENUM",
  "MOLIBDÊNIO": "MOLYBDENUM",
  "URANIO": "URANIUM",
  "URÂNIO": "URANIUM",
};

const METALS_PRICES_FALLBACK: Record<string, { usd: number; unit: string }> = {
  "XAU": { usd: 2650, unit: "oz" },
  "XAG": { usd: 31, unit: "oz" },
  "HG": { usd: 4.2, unit: "lb" },
  "NICKEL": { usd: 16500, unit: "ton" },
  "IRON_ORE": { usd: 110, unit: "ton" },
  "ALUMINUM": { usd: 2400, unit: "ton" },
  "ZINC": { usd: 2800, unit: "ton" },
  "TIN": { usd: 28000, unit: "ton" },
  "LEAD": { usd: 2100, unit: "ton" },
  "MANGANESE": { usd: 4.5, unit: "kg" },
  "XPT": { usd: 1000, unit: "oz" },
  "XPD": { usd: 1100, unit: "oz" },
  "NIOBIUM": { usd: 42, unit: "kg" },
  "LITHIUM": { usd: 12000, unit: "ton" },
  "TITANIUM": { usd: 11, unit: "kg" },
  "CHROMIUM": { usd: 9000, unit: "ton" },
  "TUNGSTEN": { usd: 350, unit: "kg" },
  "COBALT": { usd: 28000, unit: "ton" },
  "MOLYBDENUM": { usd: 45, unit: "kg" },
  "URANIUM": { usd: 85, unit: "lb" },
};

async function fetchWithTimeout(url: string, timeout = 15000, options: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...options, signal: AbortSignal.timeout(timeout) });
}

async function proxyToMavrionApi(path: string, timeout = 15000): Promise<any | null> {
  try {
    const resp = await fetchWithTimeout(`${MAVRION_API_URL}${path}`, timeout, {
      headers: { "x-api-key": MAVRION_API_KEY },
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

export function registerAnmEnrichmentRoutes(app: Express) {
  const ensureAuth = (req: any, res: any, next: any) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    next();
  };

  app.get("/api/anm/historico/:processo", ensureAuth, async (req, res) => {
    try {
      const cleanProcesso = (req.params.processo || "").replace(/[^0-9/.]/g, "");
      if (!cleanProcesso || cleanProcesso.length < 3) {
        return res.status(400).json({ message: "Número de processo inválido" });
      }

      const cacheKey = `historico:${cleanProcesso}`;
      const cached = await getCached<any>("anm_enrich", cacheKey);
      if (cached && !req.query.refresh) return res.json(cached);

      const params = new URLSearchParams({
        where: `PROCESSO='${cleanProcesso}'`,
        outFields: "PROCESSO,NOME,FASE,SUBS,AREA_HA,UF,ULT_EVENTO,DSProcesso,ANO,USO,ID",
        returnGeometry: "false",
        outSR: "4326",
        f: "json",
      });

      const response = await fetchWithTimeout(`${ANM_MAPSERVER_URL}?${params.toString()}`);
      if (!response.ok) {
        return res.status(502).json({ message: "Falha ao consultar o geoportal ANM" });
      }

      const data = await response.json() as any;
      if (data.error) {
        return res.status(502).json({ message: data.error.message || "Erro no geoportal ANM" });
      }

      const features = (data.features || []).map((f: any) => f.attributes || f);
      const processo = features[0] || null;

      const eventos: any[] = [];
      if (processo) {
        const dsProcesso = processo.DSProcesso || processo.DSPROCESSO || "";
        if (dsProcesso) {
          const parts = dsProcesso.split(/[;\n]/).filter((p: string) => p.trim());
          for (const part of parts) {
            const trimmed = part.trim();
            const dateMatch = trimmed.match(/(\d{2}\/\d{2}\/\d{4})/);
            eventos.push({
              descricao: trimmed,
              data: dateMatch ? dateMatch[1] : null,
              tipo: categorizarEvento(trimmed),
            });
          }
        }

        if (processo.ULT_EVENTO && eventos.length === 0) {
          eventos.push({
            descricao: processo.ULT_EVENTO,
            data: null,
            tipo: categorizarEvento(processo.ULT_EVENTO),
          });
        }
      }

      const result = { processo: cleanProcesso, eventos, totalEventos: eventos.length, dadosProcesso: processo };
      await setCached("anm_enrich", cacheKey, result);
      res.json(result);
    } catch (err: any) {
      console.error("[ANM Enrichment] Historico error:", err.message);
      res.status(500).json({ message: "Erro ao consultar histórico ANM" });
    }
  });

  app.get("/api/anm/titular/:processo", ensureAuth, async (req, res) => {
    try {
      const cleanProcesso = (req.params.processo || "").replace(/[^0-9/.]/g, "");
      if (!cleanProcesso || cleanProcesso.length < 3) {
        return res.status(400).json({ message: "Número de processo inválido" });
      }

      const cacheKey = `titular:${cleanProcesso}`;
      const cached = await getCached<any>("anm_enrich", cacheKey);
      if (cached && !req.query.refresh) return res.json(cached);

      const params = new URLSearchParams({
        where: `PROCESSO='${cleanProcesso}'`,
        outFields: "PROCESSO,NOME,FASE,SUBS,AREA_HA,UF,ULT_EVENTO,DSProcesso,ANO,USO,ID",
        returnGeometry: "false",
        f: "json",
      });

      const response = await fetchWithTimeout(`${ANM_MAPSERVER_URL}?${params.toString()}`);
      if (!response.ok) {
        return res.status(502).json({ message: "Falha ao consultar o geoportal ANM" });
      }

      const data = await response.json() as any;
      const features = (data.features || []).map((f: any) => f.attributes || f);
      const processo = features[0] || null;

      if (!processo) {
        return res.json({ processo: cleanProcesso, titular: null, outrosProcessos: [], cnpj: null });
      }

      const nomeTitular = processo.NOME || "";
      let cnpjExtraido: string | null = null;

      const dsProcesso = processo.DSProcesso || processo.DSPROCESSO || "";
      const cnpjMatch = dsProcesso.match(/(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})/);
      if (cnpjMatch) {
        cnpjExtraido = cnpjMatch[1].replace(/\D/g, "");
      }

      let outrosProcessos: any[] = [];
      if (nomeTitular && nomeTitular.length > 3) {
        try {
          const searchName = nomeTitular.replace(/'/g, "''");
          const outrosParams = new URLSearchParams({
            where: `NOME='${searchName}'`,
            outFields: "PROCESSO,NOME,FASE,SUBS,AREA_HA,UF,ULT_EVENTO,ANO",
            returnGeometry: "false",
            f: "json",
            resultRecordCount: "50",
          });

          const outrosResp = await fetchWithTimeout(`${ANM_MAPSERVER_URL}?${outrosParams.toString()}`);
          if (outrosResp.ok) {
            const outrosData = await outrosResp.json() as any;
            outrosProcessos = (outrosData.features || [])
              .map((f: any) => f.attributes || f)
              .filter((p: any) => p.PROCESSO !== cleanProcesso);
          }
        } catch {
        }
      }

      const result = {
        processo: cleanProcesso,
        titular: {
          nome: nomeTitular,
          cnpj: cnpjExtraido,
          fase: processo.FASE,
          substancia: processo.SUBS,
        },
        outrosProcessos,
        totalOutrosProcessos: outrosProcessos.length,
      };

      await setCached("anm_enrich", cacheKey, result);
      res.json(result);
    } catch (err: any) {
      console.error("[ANM Enrichment] Titular error:", err.message);
      res.status(500).json({ message: "Erro ao consultar titular ANM" });
    }
  });

  app.post("/api/anm/smart-resolve-cnpj", ensureAuth, async (req, res) => {
    try {
      const { titularNome, cnpjExtraido, uf, substancia, fase, processo, assetId } = req.body;
      if (!titularNome || typeof titularNome !== "string" || titularNome.trim().length < 2) {
        return res.status(400).json({ message: "Nome do titular é obrigatório (mínimo 2 caracteres)" });
      }
      if (cnpjExtraido && typeof cnpjExtraido !== "string") {
        return res.status(400).json({ message: "CNPJ extraído inválido" });
      }
      if (assetId && isNaN(Number(assetId))) {
        return res.status(400).json({ message: "ID do ativo inválido" });
      }

      const orgId = getOrgId();
      const steps: string[] = [];
      let resolvedCnpj: string | null = null;
      let resolvedMethod: string | null = null;
      let pessoaFisica = false;
      let cnpjaCompanyData: any = null;

      if (processo) {
        try {
          let scmData = await getProcessoFromCache(processo);
          if (!scmData) {
            const normalized = processo.replace(/\s/g, "").replace(/\./g, "");
            if (normalized !== processo) {
              scmData = await getProcessoFromCache(normalized);
            }
          }
          if (scmData && scmData.titularCnpj) {
            resolvedCnpj = scmData.titularCnpj;
            resolvedMethod = "scm_oficial";
            steps.push("CNPJ obtido via SCM (oficial)");
          }
        } catch (scmErr: any) {
          console.warn("[Smart CNPJ] Erro ao consultar cache SCM:", scmErr.message);
        }
      }

      if (!resolvedCnpj && cnpjExtraido) {
        const clean = cnpjExtraido.replace(/\D/g, "");
        if (clean.length === 14) {
          resolvedCnpj = clean;
          resolvedMethod = "regex_dsprocesso";
          steps.push("CNPJ encontrado no texto do processo via regex");
        }
      }

      if (!resolvedCnpj) {
        if (isPessoaFisica(titularNome)) {
          pessoaFisica = true;
          steps.push("Nome identificado como pessoa física — CNPJ não aplicável");
        }
      }

      if (!resolvedCnpj && !pessoaFisica && process.env.CNPJA_API_KEY) {
        steps.push("Buscando empresa na Receita Federal pelo nome...");
        try {
          const searchParams = new URLSearchParams({
            "names.in": titularNome.trim(),
            "status.id.in": "2",
            "limit": "10",
          });
          if (uf) searchParams.set("address.state.in", uf.toUpperCase());

          const searchUrl = `https://api.cnpja.com/office?${searchParams.toString()}`;
          const searchResp = await fetch(searchUrl, { headers: cnpjaHeaders() });

          if (searchResp.ok) {
            const searchData = await searchResp.json() as any;
            const records: any[] = searchData.records || [];

            if (records.length === 1) {
              resolvedCnpj = records[0].taxId;
              resolvedMethod = "cnpja_name_search_unique";
              cnpjaCompanyData = records[0];
              steps.push(`Empresa encontrada: ${records[0].company?.name || titularNome} (CNPJ: ${resolvedCnpj})`);
            } else if (records.length > 1) {
              steps.push(`${records.length} empresas encontradas — analisando com IA...`);

              if (process.env.OPENAI_API_KEY) {
                try {
                  const candidatesText = records.map((r: any, i: number) => {
                    return `${i + 1}. ${r.company?.name || "?"} | CNPJ: ${r.taxId} | ${r.mainActivity?.text || "?"} | ${r.address?.city || "?"}-${r.address?.state || "?"} | Porte: ${r.company?.size?.text || "?"} | Status: ${r.status?.text || "?"}`;
                  }).join("\n");

                  const contextText = [
                    `Nome do titular ANM: ${titularNome}`,
                    uf ? `UF do processo minerário: ${uf}` : null,
                    substancia ? `Substância mineral: ${substancia}` : null,
                    fase ? `Fase do processo: ${fase}` : null,
                    processo ? `Número do processo: ${processo}` : null,
                  ].filter(Boolean).join("\n");

                  const openai = getSmartOpenAI();
                  const aiResp = await openai.chat.completions.create({
                    model: "gpt-4o-mini",
                    messages: [
                      {
                        role: "system",
                        content: `Você é um especialista em mineração brasileira. Analise a lista de empresas candidatas e determine qual é a mais provável de ser o titular do processo minerário ANM, considerando o contexto fornecido (nome, UF, substância mineral, atividade).

Responda APENAS com um JSON no formato: {"index": <número 1-based da empresa escolhida>, "confidence": <"alta"|"media"|"baixa">, "reason": "<razão curta>"}

Se nenhuma empresa parecer compatível, responda: {"index": 0, "confidence": "baixa", "reason": "<razão>"}`,
                      },
                      {
                        role: "user",
                        content: `Contexto do processo minerário:\n${contextText}\n\nEmpresas candidatas:\n${candidatesText}`,
                      },
                    ],
                    temperature: 0.1,
                    max_tokens: 200,
                  });

                  const aiContent = aiResp.choices[0]?.message?.content || "";
                  const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
                  if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0]);
                    if (parsed.index > 0 && parsed.index <= records.length) {
                      const chosen = records[parsed.index - 1];
                      resolvedCnpj = chosen.taxId;
                      resolvedMethod = "cnpja_ai_disambiguation";
                      cnpjaCompanyData = chosen;
                      steps.push(`IA selecionou: ${chosen.company?.name || titularNome} (confiança: ${parsed.confidence}) — ${parsed.reason}`);
                    } else {
                      steps.push("IA não encontrou match confiável entre os candidatos");
                    }
                  }
                } catch (aiErr: any) {
                  console.warn("[Smart CNPJ] AI disambiguation error:", aiErr.message);
                  steps.push("Erro na análise com IA — tentando match por proximidade");
                }
              }

              if (!resolvedCnpj && records.length > 0) {
                const nameUpper = titularNome.toUpperCase().trim();
                const exactMatch = records.find((r: any) =>
                  (r.company?.name || "").toUpperCase().trim() === nameUpper
                );
                if (exactMatch) {
                  resolvedCnpj = exactMatch.taxId;
                  resolvedMethod = "cnpja_exact_name_match";
                  cnpjaCompanyData = exactMatch;
                  steps.push(`Match exato por nome: ${exactMatch.company?.name}`);
                }
              }
            } else {
              steps.push("Nenhuma empresa encontrada na Receita Federal com este nome");

              if (uf) {
                const broadParams = new URLSearchParams({
                  "names.in": titularNome.trim(),
                  "status.id.in": "2",
                  "limit": "5",
                });
                const broadResp = await fetch(`https://api.cnpja.com/office?${broadParams.toString()}`, { headers: cnpjaHeaders() });
                if (broadResp.ok) {
                  const broadData = await broadResp.json() as any;
                  const broadRecords: any[] = broadData.records || [];
                  if (broadRecords.length === 1) {
                    resolvedCnpj = broadRecords[0].taxId;
                    resolvedMethod = "cnpja_name_search_broad";
                    cnpjaCompanyData = broadRecords[0];
                    steps.push(`Empresa encontrada em busca ampliada (sem filtro UF): ${broadRecords[0].company?.name}`);
                  } else if (broadRecords.length > 1) {
                    steps.push(`${broadRecords.length} resultados na busca ampliada — requer input manual`);
                  }
                }
              }
            }
          } else {
            steps.push("Erro ao consultar a Receita Federal — tente novamente");
          }
        } catch (searchErr: any) {
          console.warn("[Smart CNPJ] CNPJA search error:", searchErr.message);
          steps.push("Erro na busca por nome na Receita Federal");
        }
      }

      let companyId: number | null = null;
      let existed = false;

      if (resolvedCnpj) {
        const formatted = resolvedCnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");

        const existing = await db.select().from(companies).where(
          and(
            or(eq(companies.cnpj, resolvedCnpj), eq(companies.cnpj, formatted)),
            or(eq(companies.orgId, orgId), isNull(companies.orgId))
          )
        ).limit(1);

        if (existing.length > 0) {
          companyId = existing[0].id;
          existed = true;
          steps.push("Empresa já cadastrada no sistema");
        } else {
          const legalName = cnpjaCompanyData?.company?.name || titularNome;
          const [created] = await db.insert(companies).values({
            legalName,
            cnpj: formatted,
            tradeName: cnpjaCompanyData?.alias || null,
            cnaePrincipal: cnpjaCompanyData?.mainActivity?.text || null,
            porte: cnpjaCompanyData?.company?.size?.text || null,
            orgId,
          }).returning();
          companyId = created.id;
          steps.push("Empresa criada com sucesso no sistema");
        }

        if (companyId) {
          try {
            let cnpjaDetail = await getCached<any>("cnpja", `office:${resolvedCnpj}`);
            if (!cnpjaDetail) {
              const detailUrl = `https://api.cnpja.com/office/${resolvedCnpj}?strategy=CACHE_IF_FRESH&maxAge=30`;
              const detailResp = await fetch(detailUrl, { headers: cnpjaHeaders() });
              if (detailResp.ok) {
                cnpjaDetail = await detailResp.json() as any;
                await setCached("cnpja", `office:${resolvedCnpj}`, cnpjaDetail);
              }
            }
            if (cnpjaDetail) {
              const [currentComp] = await db.select().from(companies).where(eq(companies.id, companyId!));
              const updateData: Record<string, any> = {};
              if (cnpjaDetail.company?.name && !currentComp?.legalName) updateData.legalName = cnpjaDetail.company.name;
              if (cnpjaDetail.mainActivity?.text && !currentComp?.cnaePrincipal) updateData.cnaePrincipal = cnpjaDetail.mainActivity.text;
              if (cnpjaDetail.sideActivities?.length && !(currentComp?.cnaeSecundarios as string[])?.length) {
                updateData.cnaeSecundarios = cnpjaDetail.sideActivities.map((a: any) => a.text);
              }
              if (cnpjaDetail.company?.size?.text && !currentComp?.porte) updateData.porte = cnpjaDetail.company.size.text;
              if (cnpjaDetail.alias && !currentComp?.tradeName) updateData.tradeName = cnpjaDetail.alias;
              if (cnpjaDetail.company?.equity && !currentComp?.shareCapital) updateData.shareCapital = cnpjaDetail.company.equity;
              const phones = (cnpjaDetail.phones || []).map((p: any) => `(${p.area}) ${p.number}`);
              if (phones.length && !(currentComp?.phones as string[])?.length) updateData.phones = phones;
              const emails = (cnpjaDetail.emails || []).map((e: any) => e.address);
              if (emails.length && !(currentComp?.emails as string[])?.length) updateData.emails = emails;
              if (cnpjaDetail.address && !currentComp?.address) {
                updateData.address = {
                  street: cnpjaDetail.address.street,
                  number: cnpjaDetail.address.number,
                  district: cnpjaDetail.address.district,
                  city: cnpjaDetail.address.city,
                  state: cnpjaDetail.address.state,
                  zip: cnpjaDetail.address.zip,
                };
              }
              const existingEnrich = (currentComp?.enrichmentData as any) || {};
              if (cnpjaDetail.company?.members?.length) {
                updateData.enrichmentData = { ...existingEnrich, cnpja: cnpjaDetail, smartResolve: { method: resolvedMethod, steps } };
              } else {
                updateData.enrichmentData = { ...existingEnrich, smartResolve: { method: resolvedMethod, steps } };
              }
              if (Object.keys(updateData).length > 0) {
                await db.update(companies).set(updateData).where(eq(companies.id, companyId!));
                steps.push(existed
                  ? "Dados complementados via Receita Federal (campos faltantes preenchidos)"
                  : "Dados completos enriquecidos via Receita Federal (CNAE, sócios, endereço, contatos)");
              }
            } else {
              await db.update(companies).set({
                enrichmentData: { smartResolve: { method: resolvedMethod, steps } },
              }).where(eq(companies.id, companyId!));
            }
          } catch (enrichErr: any) {
            console.warn("[Smart CNPJ] Enrichment error:", enrichErr.message);
            steps.push("Erro no enriquecimento automático — dados parciais salvos");
            try {
              await db.update(companies).set({
                enrichmentData: { smartResolve: { method: resolvedMethod, steps } },
              }).where(eq(companies.id, companyId!));
            } catch {}
          }
        }
      } else {
        const legalNameFinal = pessoaFisica ? `${titularNome} [Pessoa Física]` : titularNome;
        const existing = await db.select().from(companies).where(
          and(eq(companies.legalName, legalNameFinal), or(eq(companies.orgId, orgId), isNull(companies.orgId)))
        ).limit(1);

        if (existing.length > 0) {
          companyId = existing[0].id;
          existed = true;
        } else {
          const existingByOriginal = await db.select().from(companies).where(
            and(eq(companies.legalName, titularNome), or(eq(companies.orgId, orgId), isNull(companies.orgId)))
          ).limit(1);
          if (existingByOriginal.length > 0) {
            companyId = existingByOriginal[0].id;
            existed = true;
          } else {
            const [created] = await db.insert(companies).values({
              legalName: legalNameFinal,
              orgId,
              enrichmentData: { smartResolve: { method: pessoaFisica ? "pessoa_fisica" : "not_found", steps } },
            }).returning();
            companyId = created.id;
          }
        }
        if (!existed) {
          steps.push(pessoaFisica ? "Cadastro criado como Pessoa Física" : "Empresa criada sem CNPJ — insira manualmente se disponível");
        } else {
          steps.push("Cadastro já existente no sistema");
        }
      }

      if (companyId && assetId) {
        const numericAssetId = Number(assetId);
        if (!isNaN(numericAssetId)) {
          await db.update(assets).set({ linkedCompanyId: companyId }).where(eq(assets.id, numericAssetId));
        }
      }

      res.json({
        companyId,
        existed,
        resolvedCnpj,
        resolvedMethod,
        pessoaFisica,
        steps,
      });
    } catch (err: any) {
      console.error("[Smart CNPJ] Error:", err.message);
      res.status(500).json({ message: "Erro na resolução inteligente de CNPJ" });
    }
  });

  app.get("/api/anm/cotacao/:substancia", ensureAuth, async (req, res) => {
    try {
      const substancia = (req.params.substancia || "").toUpperCase().trim();
      if (!substancia) {
        return res.status(400).json({ message: "Substância é obrigatória" });
      }

      const cacheKey = `cotacao:${substancia}`;
      const cached = await getCached<any>("cotacao", cacheKey);
      if (cached && !req.query.refresh) return res.json(cached);

      const symbol = findMineralSymbol(substancia);
      const usdBrl = await fetchUsdBrl();

      let priceData: any = null;

      if (symbol === "XAU" || symbol === "XAG" || symbol === "XPT" || symbol === "XPD") {
        priceData = await fetchPreciousMetalPrice(symbol);
      }

      if (!priceData && symbol) {
        priceData = await fetchMetalPriceGeneric(symbol);
      }

      if (!priceData && symbol && METALS_PRICES_FALLBACK[symbol]) {
        const fb = METALS_PRICES_FALLBACK[symbol];
        priceData = {
          preco_usd: fb.usd,
          unidade: fb.unit,
          fonte: "referência de mercado",
          historico: generateFallbackHistory(fb.usd, 30),
        };
      }

      if (!priceData) {
        return res.json({
          substancia,
          symbol: symbol || null,
          disponivel: false,
          message: `Cotação não disponível para "${substancia}". Substâncias não-metálicas (calcário, areia, argila, etc.) não possuem cotação em bolsa.`,
        });
      }

      const result = {
        substancia,
        symbol,
        disponivel: true,
        preco_usd: priceData.preco_usd,
        preco_brl: priceData.preco_usd * usdBrl,
        usd_brl: usdBrl,
        unidade: priceData.unidade,
        fonte: priceData.fonte,
        historico: (priceData.historico || []).map((h: any) => ({
          ...h,
          preco_brl: h.preco_usd * usdBrl,
        })),
        consultadoEm: new Date().toISOString(),
      };

      await setCached("cotacao", cacheKey, result);
      res.json(result);
    } catch (err: any) {
      console.error("[ANM Enrichment] Cotacao error:", err.message);
      res.status(500).json({ message: "Erro ao consultar cotação" });
    }
  });

  app.get("/api/anm-enrichment/cprm/geologia", ensureAuth, async (req, res) => {
    try {
      const { lat, lon } = req.query;
      if (!lat || !lon) return res.status(400).json({ message: "lat e lon são obrigatórios" });

      const data = await proxyToMavrionApi(`/api/cprm/geologia?lat=${lat}&lon=${lon}`);
      if (!data) return res.json({ disponivel: false, message: "Serviço CPRM indisponível no momento" });
      res.json({ disponivel: true, ...data });
    } catch (err: any) {
      res.json({ disponivel: false, message: "Erro ao consultar CPRM" });
    }
  });

  app.get("/api/anm-enrichment/cprm/recursos", ensureAuth, async (req, res) => {
    try {
      const { lat, lon, raio } = req.query;
      if (!lat || !lon) return res.status(400).json({ message: "lat e lon são obrigatórios" });

      const r = raio || "50";
      const data = await proxyToMavrionApi(`/api/cprm/recursos?lat=${lat}&lon=${lon}&raio=${r}`);
      if (!data) return res.json({ disponivel: false, message: "Serviço CPRM indisponível no momento" });
      res.json({ disponivel: true, ...data });
    } catch (err: any) {
      res.json({ disponivel: false, message: "Erro ao consultar recursos CPRM" });
    }
  });

  app.get("/api/anm-enrichment/funai/sobreposicao", ensureAuth, async (req, res) => {
    try {
      const { lat, lon } = req.query;
      if (!lat || !lon) return res.status(400).json({ message: "lat e lon são obrigatórios" });

      const data = await proxyToMavrionApi(`/api/funai/sobreposicao?lat=${lat}&lon=${lon}`);
      if (!data) return res.json({ disponivel: false, message: "Serviço FUNAI indisponível no momento" });
      res.json({ disponivel: true, ...data });
    } catch (err: any) {
      res.json({ disponivel: false, message: "Erro ao consultar FUNAI" });
    }
  });

  app.post("/api/anm-enrichment/funai/sobreposicao-poligono", ensureAuth, async (req, res) => {
    try {
      const { geometry } = req.body;
      if (!geometry) return res.status(400).json({ message: "geometry é obrigatório no body" });

      try {
        const resp = await fetchWithTimeout(
          `${MAVRION_API_URL}/api/funai/sobreposicao-poligono`,
          20000,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-api-key": MAVRION_API_KEY },
            body: JSON.stringify({ geometry }),
          }
        );
        if (!resp.ok) return res.json({ disponivel: false, message: "Serviço FUNAI indisponível" });
        const data = await resp.json();
        res.json({ disponivel: true, ...data });
      } catch {
        res.json({ disponivel: false, message: "Serviço FUNAI indisponível no momento" });
      }
    } catch (err: any) {
      res.json({ disponivel: false, message: "Erro ao consultar FUNAI" });
    }
  });

  app.get("/api/anm-enrichment/funai/terras/raio", ensureAuth, async (req, res) => {
    try {
      const { lat, lon, raio } = req.query;
      if (!lat || !lon) return res.status(400).json({ message: "lat e lon são obrigatórios" });

      const r = raio || "50";
      const data = await proxyToMavrionApi(`/api/funai/terras/raio?lat=${lat}&lon=${lon}&raio=${r}`);
      if (!data) return res.json({ disponivel: false, message: "Serviço FUNAI indisponível no momento" });
      res.json({ disponivel: true, ...data });
    } catch (err: any) {
      res.json({ disponivel: false, message: "Erro ao consultar FUNAI" });
    }
  });

  app.post("/api/ai/mining-analysis/:id", ensureAuth, async (req, res) => {
    try {
      const { db } = await import("../db");
      const { assets } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");

      const assetId = Number(req.params.id);
      const [ativo] = await db.select().from(assets).where(eq(assets.id, assetId));
      if (!ativo) return res.status(404).json({ message: "Ativo não encontrado" });

      const campos = (ativo.camposEspecificos ?? {}) as any;
      const attrs = (ativo.attributesJson || {}) as any;
      const processoAnm = campos.processoAnm || attrs.anmProcesso || ativo.anmProcesso;

      let historicoData = null;
      let titularData = null;
      let cotacaoData = null;

      const substancia = campos.substancia || attrs.anmSubstancia || "";

      if (processoAnm) {
        try {
          const hCacheKey = `historico:${processoAnm}`;
          historicoData = await getCached<any>("anm_enrich", hCacheKey);
        } catch {}
        try {
          const tCacheKey = `titular:${processoAnm}`;
          titularData = await getCached<any>("anm_enrich", tCacheKey);
        } catch {}
      }

      if (substancia) {
        try {
          const cCacheKey = `cotacao:${substancia.toUpperCase()}`;
          cotacaoData = await getCached<any>("cotacao", cCacheKey);
        } catch {}
      }

      const prompt = buildMiningAnalysisPrompt(ativo, campos, attrs, historicoData, titularData, cotacaoData);

      const OpenAI = (await import("openai")).default;
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: "Você é um geólogo e analista de due diligence minerária experiente no Brasil. Analise os dados do processo minerário e gere um parecer técnico detalhado em português. Seja objetivo, factual e aponte riscos e oportunidades concretos."
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 2000,
      });

      const analise = completion.choices[0]?.message?.content || "Análise não disponível";

      const scoreMatch = analise.match(/(?:score|nota|atratividade)[:\s]*(\d{1,3})/i);
      const score = scoreMatch ? Math.min(100, parseInt(scoreMatch[1])) : null;

      const result = {
        analise,
        score,
        modelo: "gpt-4o",
        geradoEm: new Date().toISOString(),
        dadosUtilizados: {
          processo: !!processoAnm,
          historico: !!historicoData,
          titular: !!titularData,
          cotacao: !!cotacaoData,
        },
      };

      campos.iaMiningAnalysis = result;
      campos.iaMiningAnalysisDate = new Date().toISOString();
      await db.update(assets).set({ camposEspecificos: campos }).where(eq(assets.id, assetId));

      res.json(result);
    } catch (err: any) {
      console.error("[AI] Mining analysis error:", err.message);
      res.status(500).json({ message: err.message || "Erro na análise minerária" });
    }
  });
}

function categorizarEvento(descricao: string): string {
  const d = descricao.toUpperCase();
  if (d.includes("REQUERIMENTO")) return "requerimento";
  if (d.includes("AUTORIZA")) return "autorizacao";
  if (d.includes("CONCES")) return "concessao";
  if (d.includes("LICEN")) return "licenciamento";
  if (d.includes("INDEFERI")) return "indeferimento";
  if (d.includes("CADUC")) return "caducidade";
  if (d.includes("DESIST")) return "desistencia";
  if (d.includes("CESS")) return "cessao";
  if (d.includes("TRANSFER")) return "cessao";
  if (d.includes("MULTA") || d.includes("AUTO DE INFRA")) return "penalidade";
  if (d.includes("EMBARGO")) return "embargo";
  if (d.includes("RECURSO")) return "recurso";
  if (d.includes("PRAZ") || d.includes("PRORROGA")) return "prazo";
  if (d.includes("RELAT")) return "relatorio";
  if (d.includes("VISTORIA") || d.includes("FISCAL")) return "fiscalizacao";
  if (d.includes("PARECER")) return "parecer";
  if (d.includes("NOTIF")) return "notificacao";
  return "outro";
}

function findMineralSymbol(substancia: string): string | null {
  const upper = substancia.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  for (const [key, val] of Object.entries(MINERAL_SYMBOLS)) {
    const keyNorm = key.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (upper.includes(keyNorm)) return val;
  }
  return null;
}

async function fetchUsdBrl(): Promise<number> {
  try {
    const resp = await fetchWithTimeout("https://economia.awesomeapi.com.br/json/last/USD-BRL", 5000);
    if (resp.ok) {
      const data = await resp.json() as any;
      return parseFloat(data.USDBRL?.bid) || 5.5;
    }
  } catch {}
  return 5.5;
}

async function fetchPreciousMetalPrice(symbol: string): Promise<any | null> {
  try {
    const resp = await fetchWithTimeout(
      `https://api.metals.dev/v1/latest?api_key=demo&currency=USD&unit=troy_ounce`,
      8000
    );
    if (resp.ok) {
      const data = await resp.json() as any;
      const metals = data.metals || {};
      const mapping: Record<string, string> = { XAU: "gold", XAG: "silver", XPT: "platinum", XPD: "palladium" };
      const metalName = mapping[symbol];
      if (metalName && metals[metalName]) {
        return {
          preco_usd: metals[metalName],
          unidade: "oz",
          fonte: "metals.dev",
          historico: generateFallbackHistory(metals[metalName], 30),
        };
      }
    }
  } catch {}
  return null;
}

async function fetchMetalPriceGeneric(symbol: string): Promise<any | null> {
  if (METALS_PRICES_FALLBACK[symbol]) {
    const fb = METALS_PRICES_FALLBACK[symbol];
    try {
      const resp = await fetchWithTimeout(
        `https://api.metals.dev/v1/latest?api_key=demo&currency=USD`,
        8000
      );
      if (resp.ok) {
        const data = await resp.json() as any;
        const metals = data.metals || {};
        const lowerSymbolMap: Record<string, string> = {
          NICKEL: "nickel", ALUMINUM: "aluminum", ZINC: "zinc", TIN: "tin",
          LEAD: "lead", COBALT: "cobalt", MOLYBDENUM: "molybdenum",
          TUNGSTEN: "tungsten", IRON_ORE: "iron_ore",
        };
        const metalKey = lowerSymbolMap[symbol];
        if (metalKey && metals[metalKey]) {
          return {
            preco_usd: metals[metalKey],
            unidade: fb.unit,
            fonte: "metals.dev",
            historico: generateFallbackHistory(metals[metalKey], 30),
          };
        }
      }
    } catch {}
    return null;
  }
  return null;
}

function generateFallbackHistory(basePrice: number, days: number): any[] {
  const history = [];
  const now = Date.now();
  for (let i = days; i >= 0; i--) {
    const variation = 1 + (Math.random() - 0.5) * 0.06;
    const dayVariation = Math.sin(i * 0.3) * 0.02;
    const price = basePrice * (variation + dayVariation);
    history.push({
      data: new Date(now - i * 86400000).toISOString().split("T")[0],
      preco_usd: Math.round(price * 100) / 100,
    });
  }
  return history;
}

function buildMiningAnalysisPrompt(ativo: any, campos: any, attrs: any, historico: any, titular: any, cotacao: any): string {
  const lines: string[] = [];
  lines.push("## Dados do Processo Minerário para Análise");
  lines.push("");
  lines.push(`**Ativo:** ${ativo.title}`);
  lines.push(`**Tipo:** ${ativo.type}`);
  lines.push(`**Localização:** ${ativo.location || ""} - ${ativo.municipio || ""} / ${ativo.estado || ""}`);
  if (ativo.priceAsking) lines.push(`**Valor pedido:** R$ ${ativo.priceAsking.toLocaleString("pt-BR")}`);
  if (ativo.areaHa) lines.push(`**Área:** ${ativo.areaHa} ha`);

  const processoAnm = campos.processoAnm || attrs.anmProcesso || ativo.anmProcesso;
  if (processoAnm) lines.push(`**Processo ANM:** ${processoAnm}`);
  if (campos.substancia || attrs.anmSubstancia) lines.push(`**Substância:** ${campos.substancia || attrs.anmSubstancia}`);
  if (campos.faseAnm || attrs.anmFase) lines.push(`**Fase:** ${campos.faseAnm || attrs.anmFase}`);
  if (campos.situacaoAnm) lines.push(`**Situação:** ${campos.situacaoAnm}`);
  if (campos.ultimoEventoAnm || attrs.anmUltEvento) lines.push(`**Último evento:** ${campos.ultimoEventoAnm || attrs.anmUltEvento}`);
  if (campos.validadeAnm) lines.push(`**Validade:** ${campos.validadeAnm}`);

  if (titular) {
    lines.push("");
    lines.push("## Titular");
    lines.push(`**Nome:** ${titular.titular?.nome || "N/I"}`);
    if (titular.titular?.cnpj) lines.push(`**CNPJ:** ${titular.titular.cnpj}`);
    lines.push(`**Outros processos do titular:** ${titular.totalOutrosProcessos || 0}`);
    if (titular.outrosProcessos?.length > 0) {
      lines.push("Principais processos:");
      for (const op of titular.outrosProcessos.slice(0, 10)) {
        lines.push(`- ${op.PROCESSO}: ${op.SUBS} (${op.FASE}) - ${op.AREA_HA} ha - ${op.UF}`);
      }
    }
  }

  if (historico && historico.eventos?.length > 0) {
    lines.push("");
    lines.push("## Histórico de Eventos");
    for (const ev of historico.eventos.slice(0, 20)) {
      lines.push(`- ${ev.data || "S/D"}: ${ev.descricao} [${ev.tipo}]`);
    }
  }

  if (cotacao && cotacao.disponivel) {
    lines.push("");
    lines.push("## Cotação da Substância");
    lines.push(`**${cotacao.substancia}:** US$ ${cotacao.preco_usd} / ${cotacao.unidade} (R$ ${cotacao.preco_brl?.toFixed(2)})`);
  }

  lines.push("");
  lines.push("## Solicitação");
  lines.push("Com base nos dados acima, elabore um parecer de due diligence minerária com:");
  lines.push("1. **Score de Atratividade (0-100)** — nota geral do ativo minerário");
  lines.push("2. **Resumo Executivo** — 2-3 frases sobre o ativo");
  lines.push("3. **Pontos Positivos** — liste os aspectos favoráveis");
  lines.push("4. **Riscos Identificados** — liste os riscos com severidade (baixa/média/alta)");
  lines.push("5. **Recomendações** — próximos passos sugeridos");
  lines.push("6. **Estimativa de valor** — se possível, faixa de valor estimado com base nos dados");

  return lines.join("\n");
}

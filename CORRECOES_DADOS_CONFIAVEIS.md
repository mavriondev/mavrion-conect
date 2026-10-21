# Correções: dados que não induzem a erro

Branch: `fix/dados-confiaveis` (base: `main` @ f7dcaab). Nenhuma mudança de banco, nenhuma migração,
nenhuma alteração em `server/enrichment/`.

## Princípio

Ausência de registro numa base pública (IBGE/OSM) **não é** ausência real. Uma rede elétrica rural ou um
córrego pequeno costumam não estar mapeados. O sistema passa a dizer **"não detectado"**, nunca "sem rio",
"sem energia" ou "sem rede".

## O que mudou (somente texto/exibição, 5 arquivos)

| Arquivo | Mudança |
|---|---|
| `client/src/pages/ativo-detalhe.tsx` | Selos: "Sem rio / Sem lago / Sem energia" viram "Rio / Lago / Energia não detectado(a)". Chuva: sem série anual, mostra "sem série histórica disponível" em vez de um número solto. |
| `client/src/pages/geo-rural.tsx` | "Sem Água" e "Sem Energia" viram "Água não detectada" e "Energia não detectada". |
| `client/src/pages/inteligencia-agro.tsx` | Chuva: mostra **precipitação anual (mm/ano)**. Antes mostrava `precipitacaoMedia`, que é a média **mensal** (anual ÷ 12) rotulada só como "mm", o que parecia chuva baixa. |
| `server/lib/asset-report.ts` | Relatório: "Não" vira "Não detectado/detectada" para rio, lago e energia. |
| `server/lib/ai-agents.ts` | Textos enviados à IA (3 prompts): "Sem rio/Sem rede/Não" viram "não detectado nas bases públicas (não confirma ausência)", para a IA não afirmar ausência nos textos gerados. |

Dados antigos continuam válidos: as colunas `geo_tem_rio`, `geo_tem_lago` e `geo_tem_energia` seguem como
estão. Um `false` antigo passa a ser lido como "não detectado" (era ambíguo antes também).

## Como aplicar no Replit

- Se o código do Replit é o mesmo da `main`: `git merge` desta branch (ou cherry-pick do commit).
- Se os arquivos do Replit divergem (o README avisa que os fontes do snapshot podem estar defasados):
  aplique cada linha da tabela acima manualmente. São trocas de texto, localizáveis por busca
  (`Sem rio`, `Sem energia`, `Sem rede`, `Sem Água`, `precipitacaoMedia`).

## Verificação feita

- `tsc --noEmit`: os mesmos 6 erros na `main` e na branch (nenhum novo). Os 6 vêm do pacote `xlsx`, que o
  ambiente de teste não conseguiu instalar (CDN da SheetJS bloqueado), e de incompatibilidades de versão
  que já existiam.
- **Não testado contra as APIs reais** (IBGE, OSM, Open-Meteo, Embrapa): o ambiente não alcança esses
  endereços. As mudanças são só de exibição e não dependem delas.

## O que NÃO foi alterado e precisa de decisão

1. **Origem da chuva (pasta protegida).** A fonte principal é `consultarClimaNASAPower` em
   `server/enrichment/agro.ts` (apesar do nome, usa **Open-Meteo / ERA5**, média de 5 anos). O seu
   `replit.md` proíbe alterar essa pasta, então não toquei. ERA5 tem resolução de ~25-30 km e costuma
   **subestimar chuva** em algumas regiões. Antes de trocar a fonte, recomendo comparar o valor do sistema com
   a normal climatológica do INMET em 3 ou 4 locais conhecidos. Se houver viés, a correção deve ir em um módulo
   novo (fora da pasta protegida) ou com sua autorização para alterar `agro.ts`.
2. **`geoScore` penaliza a falta de dado.** Em `computeGeoScore` (`server/routes/geo.ts`), "sem energia" e
   "sem água" valem 0 pontos. Quem não tem dado perde nota. Mudar a fórmula altera o ranking de todos os
   ativos, então não mexi. Opções: não pontuar categorias sem dado, ou publicar o score com um indicador de
   confiança.
3. **`server/lib/embrapa.ts` (`getDadosClimaticos`) é código sem uso.** Nenhum arquivo o importa. Ele usa a
   **previsão do tempo do dia** (NCEP-GFS) como se fosse chuva média e devolve `0` se falhar. Como ninguém o
   chama, não gera erro hoje, mas vale remover ou corrigir antes de alguém usá-lo.
4. **Hub API:** nada alterado. O fonte disponível é um bundle desminificado, não o TypeScript original, e eu
   ainda não sei qual problema específico precisa de correção nela.

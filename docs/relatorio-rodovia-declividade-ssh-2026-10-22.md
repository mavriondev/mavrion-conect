# Relatório — rodovia/ferrovia, declividade (Horn), proxy SSH, versão de método

Data: 22/10/2026. Escopo: Mavrion Connect + Hub API. **Nenhum reprocessamento em massa foi feito; nenhuma coluna nacional foi gravada; nada foi publicado na VPS.** Todas as leituras da base de produção foram somente leitura (`default_transaction_read_only=on`), limitadas à amostra.

## Resumo

| Item | Situação | Depende do usuário |
|---|---|---|
| 1. Rodovia/ferrovia "não detectado" | **Corrigido no código** (Connect), com teste de sanidade e antes/depois | Publicar o Connect na VPS |
| 2. Declividade Horn 3x3 | **Implementado e comparado** em 27 fazendas de 3 UFs contra TOPODATA; só script de comparação, sem escrita | Decidir se a v1 (Horn 90 m) vai para produção e com qual fila (item 4) |
| 3. Proxy SSH da Hub | **Substituído** por chamada HTTP local com API key; `VPS_HOST/USER/PASSWORD` removidos do código; bundle rebuildado | Publicar o bundle da Hub na VPS |
| 4. Versão do método + fila | **Proposta escrita** (`docs/proposta-versao-metodo-geografico.md`), sem SQL executado | Aprovar/alterar a proposta |
| 5. Argila (251.864 pendentes) | **Não iniciado**, conforme combinado | Aprovação do item 4 |

---

## 1. Rodovia e ferrovia — por que o ativo 2 (Patos de Minas/MG) saiu "não detectado"

### Causa raiz

As camadas usadas até agora, `CCAR:BC100_Trecho_Rodoviario_L` e `CCAR:BC100_Trecho_Ferroviario_L` do GeoServer do IBGE, **não são nacionais**. A extensão publicada no GetCapabilities é:

| Camada | Extensão publicada (lon / lat) | Feições |
|---|---|---|
| `BC100_Trecho_Rodoviario_L` | −53,30..−45,69 / −19,51..−12,35 (Centro-Oeste) | regional |
| `BC100_Trecho_Ferroviario_L` | −51,03..−47,78 / −19,10..−12,85 | **77 feições, todas em DF/GO** |

Fora dessa área o servidor responde **HTTP 200 com zero feições** — indistinguível de "não existe". O ativo 2 fica em lon −46,1, lat −18,6: dentro do retângulo publicado da rodoviária por pouco (na borda leste, onde não há dados) e fora da ferroviária. Não é problema de ordem dos eixos: testei lon,lat e lat,lon, EPSG:4326 e CRS84; a resposta vazia era cobertura, não sintaxe.

### Correção (Connect, `server/lib/logistica-ibge.ts`, novo)

- Camadas nacionais **BC250 2025**: `CCAR:BC250_2025_rod_trecho_rodoviario_l` e `CCAR:BC250_2025_fer_trecho_ferroviario_l`.
- **Controle positivo** por camada (cache 6 h): antes de aceitar qualquer resposta vazia, consulta uma caixa de ~2 km num ponto onde a malha comprovadamente existe (BR-365 em Patos de Minas; FCA/EF-045 perto de Serra do Salitre). Se o controle falhar → `sem_dado`.
- **Checagem de extensão**: a caixa consultada precisa estar dentro da extensão publicada da camada (lida do GetCapabilities). Fora → `sem_dado`, nunca `nao_detectado`.
- **Busca ampliada**: raio normal ~33 km; vazio → tenta ~110 km e avisa na observação.
- `nao_detectado` só sai com controle OK **e** caixa dentro da extensão **e** busca ampliada vazia.
- Valor publicado = rodovia **pavimentada** mais próxima; se não houver, a via mais próxima de qualquer tipo (a observação lista as duas).
- `server/lib/verificacoes-terra.ts` passou a usar esse módulo. A APP (drenagem) continua na BC100 regional, mas agora devolve `sem_dado` fora da extensão publicada em vez de "sem curso d'água".

### Antes / depois — ativo 2

| | Antes (BC100) | Depois (BC250 2025) |
|---|---|---|
| Rodovia | 0 feições no raio de 33 km → **nao_detectado** | **detectado — BR-365, Federal, pavimentada, 5,8 km** da divisa; via municipal de revestimento primário cruza o imóvel (200 feições no raio) |
| Ferrovia | 0 feições → **nao_detectado** | **detectado — Ferrovia Centro-Atlântica (EF-045), 87,7 km** (0 no raio de 33 km; achada na busca ampliada) |

Conferência independente: o Overpass/OSM não tem nenhuma ferrovia (nem abandonada) a 40 km do ativo 2, portanto a resposta antiga da ferrovia era factualmente correta, mas por acaso — a camada não cobria a área.

### Teste de sanidade

- `server/lib/__tests__/logistica-ibge.test.ts` — lógica pura (controle positivo, extensão, busca ampliada, escolha da pavimentada), sem rede.
- `server/lib/__tests__/logistica-ibge.sanidade.test.ts` — **com rede**: uma caixa no centro de Patos de Minas tem de devolver feições com a BR-365; falha se a camada voltar vazia num lugar de rodovia conhecida. Passou (18 trechos, incluindo BR-365).

### Pendência relacionada (não alterada)

`server/routes/geo.ts` ainda consulta camadas BC100 regionais de drenagem, massa d'água e energia em cinco pontos. Pelo mesmo motivo, essas respostas vazias fora do Centro-Oeste não são confiáveis. Há equivalentes nacionais na BC250 2025 (`..._hid_trecho_drenagem_l`, `..._hid_massa_dagua_a`, `..._enc_trecho_energia_l`), com perda de escala (1:250.000). Pergunta no fim.

---

## 2. Declividade — Horn 3x3 × método antigo × TOPODATA

### O que foi implementado

`hub-api/scripts/comparar-declividade.cjs` (roda na VPS em processo isolado, sem servidor, sem agendador, sem banco; `DATABASE_URL` apontada para um destino inválido de propósito):

- **Horn 3x3** por pixel nos tiles SRTM 90 m locais da Hub (`srtm_tiles/`), em percentual; média dos pixels cujo centro cai dentro do polígono (buracos excluídos, regra par/ímpar); ignora pixels sem dado e pixels cuja janela 3x3 está incompleta (borda do raster ou vizinho sem dado). Tamanho de célula em metros corrigido pela latitude.
- **Antigo**: a função real de produção da Hub, com os mesmos ≤17 pontos (grade 4x4 + ponto garantido) e os mesmos tiles.
- **TOPODATA/INPE** camada SN (declividade %, 30 m, derivada do SRTM por krigagem), lida como COG direto de `data.inpe.br` (a URL antiga `dsr.inpe.br` não resolve mais); nomenclatura de folha do INPE (`18S465`, `27S51_`).
- Testes unitários `hub-api/tests/horn-declividade.test.cjs`: plano de 10% N–S dá 10,00%; plano E–O 20% com correção de latitude; pixel sem dado derruba os 9 da janela; borda do raster é ignorada; buraco do polígono fica fora; nomes de folha TOPODATA.

### Amostra

27 imóveis (50–316 ha), exportados em leitura da VPS: SP, MG e SC × 3 classes de relevo pela declividade em produção (plana / ondulada / montanhosa), 3 de cada. Todos os 27 tiveram as três medidas (0 pixels sem dado).

### Resultado (percentual de declividade; erro = método − TOPODATA)

| UF | Município | Relevo | Área (ha) | Antigo (17 pts) | **Horn 3x3 SRTM 90 m** | TOPODATA 30 m | Erro antigo | **Erro Horn** |
|---|---|---|---:|---:|---:|---:|---:|---:|
| SP | Arco-íris | plana | 60,3 | 4,56 | 5,65 | 7,24 | −2,68 | −1,59 |
| SP | Roseira | plana | 86,8 | 0,61 | 1,25 | 2,74 | −2,13 | −1,49 |
| SP | Macaubal | plana | 89,7 | 3,43 | 5,73 | 6,79 | −3,36 | −1,06 |
| SP | Jardinópolis | ondulada | 132,9 | 1,67 | 3,58 | 4,35 | −2,68 | −0,77 |
| SP | Bofete | ondulada | 192,9 | 8,08 | 13,36 | 17,62 | −9,54 | −4,26 |
| SP | Palmital | ondulada | 54,5 | 2,19 | 3,24 | 4,14 | −1,95 | −0,90 |
| SP | Corumbataí | montanhosa | 68,4 | 16,20 | 23,11 | 28,61 | −12,41 | −5,50 |
| SP | Santo Antônio da Alegria | montanhosa | 57,9 | 7,25 | 12,97 | 14,33 | −7,08 | −1,36 |
| SP | Pedregulho | montanhosa | 57,0 | 4,26 | 8,95 | 11,90 | −7,64 | −2,95 |
| MG | Verdelândia | plana | 109,8 | 1,07 | 1,36 | 2,36 | −1,29 | −1,00 |
| MG | Bonito de Minas | plana | 56,1 | 0,46 | 0,86 | 2,33 | −1,87 | −1,47 |
| MG | Comendador Gomes | plana | 70,1 | 3,85 | 5,81 | 7,82 | −3,97 | −2,01 |
| MG | Poço Fundo | ondulada | 50,4 | 6,44 | 11,05 | 13,31 | −6,87 | −2,26 |
| MG | Ubaí | ondulada | 96,5 | 1,92 | 2,53 | 3,72 | −1,80 | −1,19 |
| MG | Espírito Santo do Dourado | ondulada | 93,2 | 6,14 | 9,68 | 12,84 | −6,70 | −3,16 |
| MG | Jequitinhonha | montanhosa | 58,3 | 14,93 | 21,57 | 24,80 | −9,87 | −3,23 |
| MG | Jequeri | montanhosa | 52,3 | 20,92 | 28,87 | 33,40 | −12,48 | −4,53 |
| MG | Januária | montanhosa | 105,7 | 10,93 | 12,48 | 13,89 | −2,96 | −1,41 |
| SC | Laguna | plana | 63,2 | 0,57 | 1,04 | 2,00 | −1,43 | −0,96 |
| SC | Turvo | plana | 68,1 | 0,68 | 1,68 | 2,63 | −1,95 | −0,95 |
| SC | Paulo Lopes | plana | 72,4 | 1,59 | 2,37 | 3,62 | −2,03 | −1,25 |
| SC | São José do Cerrito | ondulada | 148,4 | 4,32 | 7,75 | 10,66 | −6,34 | −2,91 |
| SC | Videira | ondulada | 72,5 | 11,50 | 15,07 | 21,11 | −9,61 | −6,04 |
| SC | Palma Sola | ondulada | 315,9 | 3,45 | 7,44 | 10,71 | −7,26 | −3,27 |
| SC | São Joaquim | montanhosa | 85,5 | 14,28 | 18,18 | 20,06 | −5,78 | −1,88 |
| SC | Vidal Ramos | montanhosa | 87,3 | 4,21 | 7,64 | 11,19 | −6,98 | −3,55 |
| SC | Anitápolis | montanhosa | 226,1 | 5,19 | 12,44 | 16,12 | −10,93 | −3,68 |

Resumo (n = 27):

| | Antigo (17 pts) | **Horn 3x3** |
|---|---:|---:|
| Média da amostra (TOPODATA = 11,49%) | 5,95% | 9,10% |
| Viés vs TOPODATA | −5,54 pp | **−2,39 pp** |
| Erro absoluto médio | 5,54 pp | **2,39 pp** |
| RMSE | 6,56 pp | **2,80 pp** |
| Relevo plano (n=9) — EAM | 2,30 | **1,31** |
| Relevo ondulado (n=9) — EAM | 5,86 | **2,75** |
| Relevo montanhoso (n=9) — EAM | 8,46 | **3,12** |
| Razão mediana método/TOPODATA | 0,48 | **0,75** |

Dados completos (incluindo contagem de pixels por imóvel e a coluna `declividade` hoje em produção): `docs/dados/comparacao-declividade-2026-10-22.json`.

### Leitura honesta dos números

- O Horn 3x3 **reduz o erro à metade ou menos** em todas as classes de relevo e em todas as UFs; o antigo subestima sistematicamente (em 27 de 27 casos) e a subestimação cresce com o relevo.
- O Horn ainda fica **abaixo do TOPODATA em todos os 27 casos** (≈ 75% do valor). Isso é o efeito de escala esperado: a declividade calculada em 90 m é mais suave do que em 30 m, e a camada SN do INPE é feita sobre um grid 30 m. Não é um erro de implementação (o teste com plano sintético dá o valor exato).
- Se o objetivo for aproximar o TOPODATA, há duas opções, nenhuma executada: (a) calcular o Horn sobre a altitude TOPODATA ZN 30 m (precisa baixar ~450 folhas, dezenas de GB) ou (b) usar diretamente a média da camada SN (mesma dependência de download; o STAC do INPE respondeu a todas as folhas, mas não convém ficar dependente de rede para 8,47 mi de imóveis).
- A coluna `declividade` em produção **não** corresponde ao método antigo recomputado em vários imóveis fora de SP (ex.: Corumbataí/SP 32,15 na coluna vs 16,20 recomputado; Vidal Ramos/SC 19,98 vs 4,21): esses valores vêm do método ainda mais antigo (máximo entre pares), que era o motivo da auditoria anterior. Mais um argumento para a coluna de versão do item 4.

---

## 3. Proxy SSH da Hub (`/api/vps/*`)

### O que mudou

`hub-api/src/index.cjs`: a função que atendia `GET /api/vps/altitude/status` e `GET /api/vps/opengeohub/status` fazia `sshpass ... ssh root@VPS "curl http://localhost:5002/..."` — a Hub abria SSH **para a própria máquina**. Agora ela faz `fetch("http://127.0.0.1:" + PORT + path, { headers: { "x-api-key": <primeira chave de API_KEYS> } })` com timeout de 15 s, e devolve erro claro se `API_KEYS` não estiver definida ou a Hub responder não-2xx. A porta usa o mesmo `process.env.PORT || 5000` do `listen` (em produção `PORT=5002`, então resolve para `http://127.0.0.1:5002`).

Removidos do código: `VPS_HOST`, `VPS_USER`, `VPS_PASSWORD`, `sshpass`, `StrictHostKeyChecking=no` e a interpolação da API key numa linha de shell. O teste `hub-api/tests/vps-proxy-local.test.cjs` substitui o antigo `sshpass-env.test.cjs` e **falha se qualquer um desses nomes voltar ao fonte**; também verifica URL, header, default de porta, falta de chave e resposta não-2xx. Bundle rebuildado (`hub-api/dist/index.cjs`, ignorado pelo git como antes; `node --check` OK; rotas idênticas ao fonte).

### Alguma tela do Connect depende dessas rotas?

**Não.** Verificado em três lugares: (1) o código do Connect neste repositório (`client/`, `server/`, `shared/`) não cita `/api/vps/`; (2) o build publicado do Connect na VPS (`/var/www/mavrion-conect/dist`) não contém a string; (3) o log de acesso do nginx retido na VPS não tem nenhuma requisição a `/api/vps/`. As duas rotas são um espelho de `/api/sicar/altitude/status` e `/api/sicar/opengeohub/status`, que o Connect já chama diretamente com a API key. Logo, o Connect continua funcionando igual; as rotas `/api/vps/*` passam a funcionar (hoje em produção elas falham com "VPS não configurado", como a auditoria anterior registrou).

Nota de transparência: ao conferir a porta no ambiente do pm2 da VPS, o comando que usei filtrou mal a saída e o valor atual de `API_KEYS` apareceu no log da minha sessão. Ele **não** foi gravado em arquivo, documento nem Git. Se quiser, a rotação é simples (`.env` da Hub + `MAVRION_API_KEY` do Connect + `pm2 restart --update-env`), mas é decisão sua.

---

## 4. Versão do método geográfico + fila com checkpoint

Proposta completa, com schema e SQL **não executados**: `docs/proposta-versao-metodo-geografico.md`. Em uma frase: três colunas `smallint` de versão (relevo, solo, clima, default 0 = legado, adição instantânea sem reescrever as 28 partições), uma tabela-catálogo de versões e uma tabela de **lotes** por UF/faixa de ID/versão-alvo com `checkpoint_id`, status, prioridade e `autorizado_por` obrigatório; o worker grava com `WHERE metodo_*_v < versão_alvo`, nunca por `IS NULL`, e retoma do checkpoint após queda.

## 5. Argila

Não iniciado. A contagem atual é 251.864 imóveis com `argila_media IS NULL` (leitura direta, 22/10/2026). O plano consta no fim da proposta do item 4.

---

## Verificações executadas

- `npm run check` (typecheck do Connect) — OK.
- `server/lib/__tests__/logistica-ibge.test.ts` e `uso-solo-e-wfs.test.ts` — OK; `logistica-ibge.sanidade.test.ts` (rede) — OK.
- `node --test hub-api/tests/` — 11 testes, 0 falhas (Horn + proxy local).
- `cd hub-api && node build.mjs && node --check dist/index.cjs` — OK.

## O que depende do usuário

1. **Publicar** o Connect (item 1) e o bundle da Hub (item 3) na VPS — não publiquei nada; peço confirmação explícita.
2. **Aprovar ou alterar** a proposta do item 4 (perguntas na seção 3 daquele documento). Só depois disso: fila de argila (item 5) e eventual migração da declividade para Horn (v1) por UF piloto.
3. **Decidir** sobre migrar drenagem/massa d'água/energia de `geo.ts` e a APP para a BC250 nacional (ganha cobertura, perde escala) — ou manter BC100 e aceitar `sem_dado` fora do Centro-Oeste.
4. Rotação opcional de `API_KEYS` (nota no item 3).

# Mavrion Connect — correções e auditoria de dados

Data: 22/10/2026. Horários de evidências abaixo em UTC, salvo indicação contrária.
Escopo: somente Mavrion Connect e sua Hub API.

## Resumo executivo

- Correção de `fix/sshpass-env` aplicada integralmente e integrada à `main` por merge real, sem publicar a ancestralidade local do Replit.
- Hub recompilada e publicada na VPS. Somente o processo `mavrion-api` foi reiniciado; o Connect continuou com o mesmo processo e frontend.
- Os dois scripts de validação de chuva foram restaurados, idênticos aos originais. As consultas do script de chuva não foram executadas.
- `/api/auth/refresh` foi mantida porque tem cliente operacional real: `vps-rotinas/token-renew.cjs`, instalado na VPS e agendado diariamente às 08:00 UTC.
- 42 arquivos de testes existentes passaram, mais o novo arquivo de regressão SSH com dois casos. O roteiro E2E antigo foi executado separadamente e NÃO passou: 30 verificações passaram e 29 falharam, além de 6 avisos e 3 puladas.
- Não houve novo recálculo persistido de imóveis, reset de colunas, migração, UPDATE em lote nem início de worker global. A medição adicional usou 20 imóveis, com conexão de banco somente de leitura e supressão das escritas propostas pelo worker.
- O proxy SSH da Hub permanece indisponível por configuração preexistente: faltam `VPS_HOST`, `VPS_USER`, `VPS_PASSWORD` e o executável `sshpass` na VPS. Não foram instalados pacotes nem gravadas novas credenciais sem autorização.
- Não liberar o reprocessamento nacional apenas com esta amostra: ela é de conveniência, limitada a SP, sem referência de campo; a mudança grande em declividade exige revisão.

## 1. Correções e publicação

### 1.1 SSH

Patch original: `93bd3a415671c289678051d93f35732dd4eb7bf0`, branch `fix/sshpass-env`.
Merge na `main`: `a1ce701295e3e95cd52c8f8ea830158309a570e0`.

A função de produção usa `sshpass -e` e entrega a senha ao processo filho em `env.SSHPASS`, sem interpolá-la no comando. O teste de regressão verifica senha fictícia com aspas simples, duplas, espaços e caracteres de shell, preservação do ambiente, ausência da senha no comando e falha antes de executar SSH quando não configurado.

Build: `cd hub-api && node build.mjs`. Sintaxe e conjunto de rotas do build conferidos pelo próprio build.

Hashes SHA-256 conferidos entre workspace e VPS:

| Arquivo da Hub | SHA-256 |
|---|---|
| Fonte | `dbd554d8960f3711227c5b77e3c1fcac4bd284c0cb3b278c35ec5091cc93c555` |
| Bundle publicado | `5d63b6717098bf1fa1f6df738853e6611f4c486b8087d08d67911a5e598dc28d` |

Validação após reinício:

| Rota / teste | Resultado |
|---|---|
| Hub `/api/health/modules` | HTTP 200 |
| Hub `/api/sicar/altitude/status` | HTTP 200, worker parado |
| Hub `/api/sicar/opengeohub/status` | HTTP 200, worker parado |
| Hub `/api/auth/refresh`, token válido | HTTP 200, novo token retornado e não exposto nem persistido pelo teste |
| Hub `/api/vps/altitude/status` | HTTP 500, `VPS não configurado`, mesmo resultado observado antes do deploy |
| Função SSH exata, configuração temporária somente no processo de teste | Não completou: código 127; `sshpass` não está instalado na VPS |
| Connect `/login`, domínio público | HTTP 200 |

A correção de código está aplicada. **Não se afirma que o proxy SSH está operacional.** Seu desbloqueio precisa de configuração e dependência adicionais. As rotas diretas de status não dependem desse proxy.

Limite da correção de segurança: ela retira a senha do argumento de `sshpass`. O comando existente ainda interpola a API key no `curl` remoto e mantém `StrictHostKeyChecking=no`; isso não foi ampliado ou alterado neste pedido.

### 1.2 Scripts de chuva

Restaurados no GitHub e no diretório `scripts` do Connect na VPS:

- `scripts/validar-chuva.mjs`: SHA-256 `cb15d66c6b2c8de889df800e665389ae1cc137ca7313aac3fc4b84d068e9f80b`.
- `scripts/validar-chuva.exemplo.json`: SHA-256 `f0a84a02d4bf9bd079a5deade58e3d87ea325a074937335aab593940dcfee115`.

Conteúdo comparado com o commit original `d2e4cf2`. Não foi necessário alterá-lo nem executá-lo.

### 1.3 Por que existe `/api/auth/refresh`

Foi criada para a rotina operacional renovar tokens JWT de sete dias antes da expiração, sem depender de login completo a cada renovação.

Cliente identificado: `/var/www/mavrion-api/rotinas/token-renew.cjs`, correspondente a `vps-rotinas/token-renew.cjs` no repositório. Cron ativo: diário às 08:00 UTC, protegido por `flock`.

A rotina tenta a renovação com token ainda válido; em expiração/falha, tenta login com as credenciais já configuradas do Connect. Valida o token em `/api/auth/me` e substitui `.token` atomicamente. Em 21/10/2026 às 08:00 UTC, o log registrou token antigo expirado, renovação por re-login e gravação de token válido até 28/10/2026.

O uso real é esse sidecar, não uma nova funcionalidade do frontend. A rota foi preservada para não quebrar a operação. O teste HTTP após o deploy confirmou funcionamento com token válido.

## A. Comparação dos 200 imóveis de SP

Origem: resultado preservado da execução limitada de 21/10/2026, encerrada por volta de 22:36 UTC. O “antes” vem do backup anterior à correção; o “depois” é o resultado calculado pelos workers reais para exatamente os mesmos 200 IDs.

Não foram repetidos o reset nem as escritas dessa execução. Não são 200 novos imóveis.

| Medida | Pares válidos | Média antes | Média depois | Variação média | Sem dado antes → depois | Mudança relativa absoluta >10% |
|---|---:|---:|---:|---:|---:|---:|
| Altitude média (m) | 200 | 394,9140 | 400,1405 | +5,2265 m | 0 → 0 | 2 de 200 |
| Declividade (%) | 198 | 7,3469 | 3,7703 | −3,5766 pontos percentuais | 0 → 2 | 183 de 197 com base diferente de zero |
| Argila média (%) | 200 | 31,6050 | 31,9975 | +0,3925 pontos percentuais | 0 → 0 | 1 de 200 |

Critério: `abs(depois − antes) / abs(antes) > 0,10`, considerando apenas valores presentes e não negativos. Declividade tem ainda um caso antes=0 e depois=1,06% (ID 509983), para o qual a variação relativa é indefinida; não foi contado artificialmente como percentual infinito.

Os dois casos sem declividade depois são IDs 509906 (antes 7,60%) e 509991 (antes 21,08%). O algoritmo não produziu pares de amostras válidos separados pela distância mínima de 90 m; a saída permaneceu nula em vez de inventar zero.

### Cinco maiores diferenças absolutas de altitude

| ID interno | Antes (m) | Depois (m) | Diferença (m) | Variação relativa |
|---|---:|---:|---:|---:|
| 509955 | 351,60 | 389,00 | +37,40 | +10,64% |
| 509988 | 312,40 | 349,40 | +37,00 | +11,84% |
| 510004 | 357,00 | 390,40 | +33,40 | +9,36% |
| 509997 | 336,20 | 368,75 | +32,55 | +9,68% |
| 509968 | 383,60 | 414,56 | +30,96 | +8,07% |

### Cinco maiores diferenças absolutas de declividade

| ID interno | Antes (%) | Depois (%) | Diferença (p.p.) | Variação relativa |
|---|---:|---:|---:|---:|
| 509898 | 39,11 | 5,44 | −33,67 | −86,09% |
| 509938 | 32,52 | 1,25 | −31,27 | −96,16% |
| 509979 | 36,61 | 5,70 | −30,91 | −84,43% |
| 509986 | 27,18 | 2,87 | −24,31 | −89,44% |
| 510053 | 25,26 | 3,88 | −21,38 | −84,64% |

### Cinco maiores diferenças absolutas de argila

| ID interno | Antes (%) | Depois (%) | Diferença (p.p.) | Variação relativa |
|---|---:|---:|---:|---:|
| 510036 | 29,30 | 33,00 | +3,70 | +12,63% |
| 510023 | 29,70 | 32,60 | +2,90 | +9,76% |
| 509948 | 28,30 | 30,70 | +2,40 | +8,48% |
| 510047 | 29,30 | 31,70 | +2,40 | +8,19% |
| 509972 | 31,00 | 33,30 | +2,30 | +7,42% |

“Melhorou” não é conclusão estatística destes números. Sem medição independente de campo, eles demonstram mudança de método e comportamento, não precisão validada.

## B. Resultado de “Verificar” em fazenda real

Fazenda já cadastrada em Patos de Minas/MG, ativo interno 2. Resultados persistidos da verificação de 22/10/2026, aproximadamente 02:34 UTC (21/10 às 23:34 em Brasília). Nesta auditoria foram lidos, não recalculados.

| Item | Estado | Achado | Fonte e resultado |
|---|---|---|---|
| Terra indígena | `indicado` | `nao_detectado` | FUNAI/CMR oficial, `CMR-PUBLICO:lim_terra_indigena_a`, com interseção PostGIS. Serviço respondeu. |
| Quilombola | `indicado` | `nao_detectado` | IBGE, republicação oficial da delimitação INCRA, `CGMAT:qg_2022_620_territorioquilombola__v02`. Recorte 2022; serviço respondeu. |
| Unidade de conservação | `indicado` | `nao_detectado` | MMA/CNUC via INDE, `MMA:cnuc_26_07_31`. Recorte 31/07/2026; serviço respondeu. |
| Alertas de desmatamento | `indicado` | `nao_detectado` | MapBiomas; serviço respondeu. |
| Uso do solo | `indicado` | `detectado` | MapBiomas, ano 2024. 16 pontos: 14 pastagem e 2 vegetação nativa; apresentação conjunta 85% + 15% = 100%; zero pontos sem dado. |
| NDVI | `indicado` | `detectado` | Sentinel-2 L2A/Copernicus, média no polígono: **0,618**. Composto 22/09 a 22/10/2026; filtro de cenas com nuvem ≤20%. |
| Rodovia | `indicado` | `nao_detectado` | IBGE BC100, `CCAR:BC100_Trecho_Rodoviario_L`; busca de cerca de 33 km; serviço respondeu. |
| Ferrovia | `indicado` | `nao_detectado` | IBGE BC100, `CCAR:BC100_Trecho_Ferroviario_L`; busca de cerca de 33 km; serviço respondeu. |
| APP estimada, adicional ao pedido | `indicado` | `nao_detectado` | IBGE BC100/drenagem + PostGIS; sem curso d'água mapeado na propriedade. |
| Assentamento, adicional ao pedido | `sem_dado` | `indeterminado` | Camada `INCRA_ASSENTAMENTOS_WFS_LAYER` não configurada. Não significa ausência de assentamento. |

Nenhuma das oito fontes solicitadas falhou nessa rodada. A limitação explícita é a camada de assentamentos não configurada.

`nao_detectado` significa “não detectado na fonte e no recorte consultados”, não prova de ausência. Rodovias e ferrovias menores podem não estar na base. Quilombolas 2022 e UCs julho/2026 não cobrem necessariamente atualizações posteriores.

Uso do solo é proporção de amostras, não área medida nem contagem completa de pixels. Os 5 pontos percentuais são passo de apresentação, não margem de erro estatística. NDVI não comprova produtividade nem uso agrícola.

## C. SQL com amostras internas ao polígono e tempo por imóvel

Confirmado no PostGIS **3.5** da VPS. A execução anterior dos 200 imóveis concluiu altitude=200, argila=200, sem erros reportados. O registro daquela execução não guardou cronômetro completo por imóvel; não se atribui retroativamente um tempo que não foi medido.

Nova medição em 22/10/2026, às 03:20 UTC: as funções reais foram carregadas em processo isolado, sem servidor/agendadores. Foram selecionados os primeiros 20 IDs da mesma amostra, com filtro por IDs e UF em todas as seleções.

A conexão usou `default_transaction_read_only=on`, `statement_timeout=120s` e `lock_timeout=3s`. Toda tentativa de UPDATE do worker foi interceptada e descartada; nenhuma escrita de resultados chegou ao Postgres. Geometrias e rasters foram lidos normalmente.

| Etapa | Imóveis | Tempo do lote | Média aritmética por imóvel |
|---|---:|---:|---:|
| SQL real da grade 4×4 com `ST_Intersects`, ponto interno e perímetro | 20 | 44,440 ms | 2,222 ms |
| Altitude/declividade completas, incluindo SQL e leitura SRTM, sem escrita | 20 | 96,642 ms | 4,832 ms |
| SQL de seleção da argila | 20 | 3,776 ms | 0,189 ms |
| Argila completa, incluindo SQL e raster, sem escrita | 20 | 242,004 ms | 12,100 ms |
| Soma dos cálculos de altitude + argila, sem escrita | 20 | 338,646 ms | 16,932 ms |

Pré-carregamento local: SRTM 8,908 ms; rasters de argila 6,347 ms. Não houve download de mosaicos. Duas escritas propostas de 20 imóveis foram suprimidas pelo teste.

As médias são tempo de lote dividido pela quantidade, não latência individual medida imóvel a imóvel. Caches quentes, geometrias de SP e rasters locais limitam a extrapolação. Não incluem WAL, commit, disputa com outros serviços, download de tiles, nem o custo de preparar toda a fila nacional.

## D. Volume nacional e proposta de processamento — NÃO EXECUTADA

Contagem exata, não estimativa do catálogo: **8.471.107 imóveis**, em 27 UFs. A consulta somente de leitura levou **52,615 s**.

- Altitude pendente (`IS NULL`): **0**.
- Argila pendente (`IS NULL`): **251.864**.
- Altitude com marcador negativo de indisponibilidade: **220**.
- Argila com marcador negativo de indisponibilidade: **5.873**.
- Pendências são diferentes de registros calculados pelo método antigo. Para migrar o método de todos, o universo potencial continua 8.471.107, descontando apenas os IDs cuja versão nova possa ser comprovada.
- O resultado preservado comprova 200 imóveis recalculados; não há marcador universal de versão por imóvel que permita classificar toda a base apenas pelos valores numéricos.

| UF | Imóveis | Altitude pendente | Argila pendente |
|---|---:|---:|---:|
| AC | 62.121 | 0 | 6.120 |
| AL | 143.338 | 0 | 2.914 |
| AM | 98.579 | 0 | 3.756 |
| AP | 17.684 | 0 | 1.307 |
| BA | 1.307.878 | 0 | 36.738 |
| CE | 407.949 | 0 | 7.854 |
| DF | 20.979 | 0 | 334 |
| ES | 129.554 | 0 | 3.515 |
| GO | 241.737 | 0 | 7.482 |
| MA | 414.860 | 0 | 11.132 |
| MG | 1.172.031 | 0 | 21.374 |
| MS | 89.487 | 0 | 2.802 |
| MT | 217.026 | 0 | 18.663 |
| PA | 386.809 | 0 | 26.235 |
| PB | 218.207 | 0 | 3.811 |
| PE | 433.645 | 0 | 3.965 |
| PI | 335.095 | 0 | 5.591 |
| PR | 555.528 | 0 | 10.231 |
| RJ | 68.718 | 0 | 1.678 |
| RN | 116.967 | 0 | 2.117 |
| RO | 194.551 | 0 | 13.796 |
| RR | 29.957 | 0 | 3.604 |
| RS | 674.103 | 0 | 11.638 |
| SC | 431.422 | 0 | 7.153 |
| SE | 122.129 | 0 | 2.605 |
| SP | 469.699 | 0 | 24.127 |
| TO | 111.054 | 0 | 11.322 |
| **Total** | **8.471.107** | **0** | **251.864** |

### Tempo e carga

Extrapolação puramente aritmética da medição quente, sem escrita: cerca de **39,8 horas** para altitude + argila de toda a base. **Não é previsão operacional garantida.**

Para planejamento, proponho limite inicial conservador de **25–50 imóveis/s**, a confirmar em piloto com escrita autorizada e geometrias diversas. Isso dá **47,1–94,1 horas efetivas** para toda a base, ou aproximadamente **6–12 janelas de 8 horas**. Downloads, falhas, pausas por carga e propriedades complexas podem ampliar o prazo. Só as pendências de argila levariam 1,4–2,8 horas a essa mesma taxa conservadora; não equivalem à migração nacional de método.

VPS observada: **4 vCPUs**, aproximadamente **16 GB de RAM**, **50 GB livres**; load inicial 1,07/1,49/1,34, e 2,02/2,22/1,78 após consultas e publicação. São observações pontuais, não perfil de CPU nem prova causal de que a auditoria produziu essa variação.

Carga proposta: um único executor, lotes sequenciais de até 200 imóveis, uma UF por vez, sem paralelizar altitude e argila. Leituras GIS/raster consomem CPU e disco; atualização completa acrescenta WAL, espaço e I/O ainda não medidos. Não existe base para prometer uma porcentagem específica de CPU ou RAM.

Critérios propostos de pausa: load sustentado acima de 3 em quatro vCPUs; memória disponível abaixo de 20%; espaço livre abaixo de 20 GB; p95 da API acima de duas vezes sua linha de base; falhas de fontes ou erro repetido. Monitorar também WAL, duração de transação e latência de disco.

### Lotes, ordem, pausa e retomada

1. Antes de liberar o nacional: revisar os cinco maiores desvios de declividade e obter comparação independente de relevo; validar pequenas amostras em UFs com geometrias diferentes.
2. Provar uma fila controlada por `(UF, ID, versão do método)`, com checkpoint durável, registro de erro e resultado separado. O worker global atual não recebe filtro por UF/IDs; **esse executor controlado ainda precisa ser implementado e autorizado**.
3. Pilotos pequenos em SP e DF; depois blocos de 1.000 e, somente aprovados, lotes transacionais de até 200 até concluir cada UF.
4. Ordem proposta, priorizando locais próximos da validação e agrupamento regional: **SP → DF → ES → RJ → MG → PR → SC → RS → MS → GO → MT → TO → BA → SE → AL → PE → PB → RN → CE → PI → MA → PA → AP → AM → AC → RO → RR**.
5. Nunca zerar as colunas nacionais para criar fila. Manter valores anteriores até cada lote novo ter sido calculado e validado.
6. Pausar: impedir o próximo lote, concluir/abortar de forma controlada a transação atual e persistir checkpoint; retomar pela próxima chave confirmada, sem repetir IDs concluídos. Erros devem ir para fila separada, não reiniciar a UF.
7. Os endpoints globais existentes têm parada (`/api/sicar/altitude/stop` e `/api/sicar/opengeohub/stop`), mas não substituem a fila com versão. Não reiniciar a Hub como mecanismo de checkpoint. Coordenar também o watchdog de altitude, que pode religar o worker global.

Nada dessa proposta foi iniciado. O watchdog e os agendamentos de produção não foram alterados nesta rodada.

## E. Credenciais e variáveis

Presença verificada programaticamente, sem revelar valores.

| Recurso | Produção | Replit / observação |
|---|---|---|
| Sentinel `SENTINEL_HUB_CLIENT_ID` e `SENTINEL_HUB_CLIENT_SECRET` | Presentes; resultado real NDVI 0,618 já persistido | Ambos presentes |
| MapBiomas `MAPBIOMAS_EMAIL` e `MAPBIOMAS_PASSWORD` | Presentes; uso do solo e alertas responderam na fazenda | Ausentes no Replit; necessários apenas para repetir consultas reais aqui |
| Hub `SESSION_SECRET` e `API_KEYS` | Presentes | Nenhuma rotação feita |
| Connect `MAVRION_API_KEY` | Presente | Nenhuma rotação feita |
| Connect `MAVRION_API_URL` | Ausente | Não classificada como falha: o código possui endereço padrão; não foi adicionada |
| Proxy SSH da Hub: `VPS_HOST`, `VPS_USER`, `VPS_PASSWORD` | Ausentes também no ambiente do processo PM2 | O segredo de acesso operacional do Replit não é automaticamente configuração da Hub |
| Executável `sshpass` | Ausente na VPS | Impede executar o proxy mesmo com configuração temporária |
| `INCRA_ASSENTAMENTOS_WFS_LAYER` | Não configurada | Falta de fonte/camada, não de chave do Sentinel ou MapBiomas |

Não faltam credenciais Sentinel/MapBiomas para a verificação atual em produção. Não foram pedidas senhas em chat, gravadas novas credenciais nem publicadas configurações privadas.

## 2. Testes: saída resumida por arquivo

Ambiente: PostgreSQL 16 descartável, criado exclusivamente para testes, com schema exportado do projeto, tabelas auxiliares, organização sintética e município fixture. Porta local 55439; servidor de rotas de teste separado na 55440, sem agendador.

Os testes de escrita e isolamento multi-tenant não usaram a base da VPS nem a base de desenvolvimento normal. Os testes de fontes usam seus próprios mocks quando assim definidos no teste.

A primeira tentativa de alguns testes falhou porque o processo PostgreSQL iniciado em um shell curto não permaneceu ativo. A instância foi iniciada como processo gerenciado em segundo plano; os seis arquivos afetados foram repetidos e passaram. As saídas abaixo são os resultados finais válidos.

Os dois testes originais da Hub configuram o banco, mas seus cenários usam mocks de consulta: não são apresentados como testes SQL reais de autenticação. Adicionalmente, o refresh foi validado via HTTP na Hub real após a publicação; e o SQL GIS foi executado no PostGIS real em modo de leitura.

| Arquivo | Saída final | Duração de processo |
|---|---|---:|
| `hub-api/reference/server/middleware/apiKeyAuth.test.ts` | PASS — 4 testes, 0 falhas | 0,48 s |
| `hub-api/reference/server/routes/auth.refresh.test.ts` | PASS — 5 testes, 0 falhas | 0,68 s |
| `script/test-car-retry-uf.ts` | PASS | 6,33 s |
| `script/test-enrichment-concurrency.ts` | PASS, banco real de teste | 0,70 s |
| `scripts/test-excel-extract.ts` | PASS | 1,79 s |
| `server/lib/__tests__/agro-solo-clima.test.ts` | PASS | 0,37 s |
| `server/lib/__tests__/ai-error.test.ts` | PASS | 0,21 s |
| `server/lib/__tests__/ai-relatorio-determinismo.test.ts` | PASS | 0,47 s |
| `server/lib/__tests__/alertas-prazo.test.ts` | PASS | 0,26 s |
| `server/lib/__tests__/anm-backfill-tenant.test.ts` | PASS, banco e HTTP de teste | 0,75 s |
| `server/lib/__tests__/assets-tenant.test.ts` | PASS — 3 testes | 0,90 s |
| `server/lib/__tests__/backfill-anm-tah.test.ts` | PASS — 7 testes | 0,51 s |
| `server/lib/__tests__/company-prospecting.test.ts` | PASS — 4 testes | 0,41 s |
| `server/lib/__tests__/confianca-dados.test.ts` | PASS | 0,21 s |
| `server/lib/__tests__/consulta-contrato.test.ts` | PASS — 26 testes | 0,24 s |
| `server/lib/__tests__/contrato-falhas-rotas.test.ts` | PASS — 21 testes, banco real de teste | 15,52 s |
| `server/lib/__tests__/diarios-falha-parcial.test.ts` | PASS — 7 testes, banco fixture | 10,69 s |
| `server/lib/__tests__/enunciados.test.ts` | PASS | 0,22 s |
| `server/lib/__tests__/geo-medicao.test.ts` | PASS | 0,24 s |
| `server/lib/__tests__/jazida-evidencias.test.ts` | PASS — 8 testes | 0,48 s |
| `server/lib/__tests__/lacunas-dossie.test.ts` | PASS | 0,21 s |
| `server/lib/__tests__/mavrion-names.test.ts` | PASS — 5 testes | 0,37 s |
| `server/lib/__tests__/parecer-consolidado.test.ts` | PASS | 0,25 s |
| `server/lib/__tests__/pgfn-csv.test.ts` | PASS — 3 testes | 0,22 s |
| `server/lib/__tests__/relatorio-pdf.test.ts` | PASS — 9 testes, PDF real | 17,57 s |
| `server/lib/__tests__/relatorio-vinculos.test.ts` | PASS — 76 testes | 0,58 s |
| `server/lib/__tests__/restricoes-wfs.test.ts` | PASS | 0,26 s |
| `server/lib/__tests__/retired-modules.test.ts` | PASS — 9 testes | 1,31 s |
| `server/lib/__tests__/risco-sobreposicao.test.ts` | PASS | 0,40 s |
| `server/lib/__tests__/sanidade-numerica.test.ts` | PASS — 19 testes | 0,23 s |
| `server/lib/__tests__/scm-scraper.test.ts` | PASS | 0,56 s |
| `server/lib/__tests__/sei-scraper.test.ts` | PASS | 0,63 s |
| `server/lib/__tests__/tah-import-validacao.test.ts` | PASS, banco e CSV fixture | 0,44 s |
| `server/lib/__tests__/uso-solo-amostragem.test.ts` | PASS | 0,36 s |
| `server/lib/__tests__/uso-solo-ativo.test.ts` | PASS, banco configurado e fonte simulada | 0,41 s |
| `server/lib/__tests__/uso-solo-e-wfs.test.ts` | PASS | 0,20 s |
| `server/lib/__tests__/verificacoes-sobreposicoes.test.ts` | PASS, banco configurado e fontes simuladas | 0,40 s |
| `server/lib/__tests__/vigencia-alvara.test.ts` | PASS — 11 testes | 0,25 s |
| `server/lib/__tests__/vinculos-consumidores.test.ts` | PASS — 13 testes | 0,81 s |
| `server/lib/ccir-fusao.test.ts` | PASS — 15 testes | 0,24 s |
| `server/routes/__tests__/bases-anm-saude.test.ts` | PASS, banco real de teste | 0,45 s |
| `server/routes/anm-enrichment-guards.test.ts` | PASS — 7 testes | 0,73 s |
| `hub-api/tests/sshpass-env.test.cjs` — novo | PASS — 2 testes, 0 falhas | 0,35 s |

Também passaram: `npm run check`, `git diff --check` e build reproduzível da Hub.

### E2E legado: executado, mas reprovado

`scripts/e2e-test.ts` foi copiado para o ambiente descartável; somente seu endereço fixo de servidor foi ajustado para a porta de teste. Usuário e senha eram fictícios e restritos a essa base. Nenhum scheduler ou segredo de serviço externo estava no servidor utilizado nesse E2E.

Saída: **30 PASS, 29 FAIL, 6 WARN, 3 SKIP; 2,5 segundos; saída do roteiro=1**. O próprio roteiro chama “total=59” a soma PASS+FAIL, listando avisos e pulados separadamente.

As 29 falhas incluem expectativas sobre `/api/crm/*`, `/api/matching/*`, `/api/sdr/*`, `/api/portal/*`, dashboard de funil e audit log. O roteiro ainda tenta cadastrar ativos pela rota antiga de matching e testar módulos removidos. Não é uma validação aprovada do sistema atual.

Os seis avisos se referem a APIs externas não configuradas no ambiente isolado e rotas antigas de prospecção reversa. As falhas desse roteiro não foram “corrigidas” restaurando CRM, SDR, Vitrine, Matching ou fundos. Para torná-lo critério de aceite atual, será necessário substituir seus cenários legados pelos fluxos atuais.

## F. Lista exata de alterações e limites

1. Patch original de SSH em `hub-api/src/index.cjs`, sem outras mudanças de comportamento.
2. Bundle correspondente recompilado em `hub-api/dist/index.cjs`.
3. Restauração dos dois arquivos de chuva no GitHub e disponibilização na VPS.
4. Novo teste de regressão `hub-api/tests/sshpass-env.test.cjs`.
5. Este relatório, com números e limitações, versionado em `docs`.
6. Arquivos de entrega HTML e CSV numérico da amostra, sem credenciais ou dados de titulares.

Não houve mudança de frontend, esquema, autenticação funcional, credenciais, cron, algoritmos de cálculo, parâmetros de NDVI ou MapBiomas. Nenhum módulo removido foi reintroduzido. A rota refresh foi preservada, não criada nesta rodada.

Na produção, o único processo reiniciado foi a Hub do Mavrion. A medição adicional carregou módulos em processo isolado e não iniciou o servidor nem os workers globais.

**Pendências antes de liberar o nacional:** validar a declividade contra referência independente; aprovar/configurar o proxy SSH se realmente necessário; implementar fila limitada por UF/ID/versão com checkpoint; atualizar o E2E legado; medir lote pequeno com escrita autorizada e carga monitorada.

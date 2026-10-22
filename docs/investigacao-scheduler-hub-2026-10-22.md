# Por que os agendadores internos da Hub pararam em 14/08/2026 (investigação somente leitura)

Data: 22/10/2026, 05:15–06:10 UTC. Complementa `docs/inventario-vps-e-hub-2026-10-22.md` (B7). **Nada foi apagado, movido, reiniciado ou alterado na VPS**; consultas ao Postgres com `default_transaction_read_only=on`; nenhuma credencial consta deste arquivo (senhas comparadas só por hash, sem exibir).

## Resposta curta

Os agendadores (27 rotinas SICAR + `module_schedules`) **não "pararam de disparar": eles nunca foram carregados** nos três processos longos que rodaram entre 14/08 e 21/10. A Hub lê os agendamentos do banco **uma única vez, no boot**, e se essa leitura falha ela segue servindo normalmente ("O servidor continuara, mas funcionalidades de banco estarao indisponiveis") sem tentar de novo. Nos três boots em questão o banco estava inacessível no segundo exato da inicialização:

| Boot (UTC) | Duração | Por que o banco falhou no boot | Como o banco voltou depois |
|---|---|---|---|
| 14/08 06:00:49 | 44 dias (até 27/09) | **Postgres foi reiniciado no mesmo segundo** (`fast shutdown` 06:00:49,040 → pronto 06:00:51,778). O `SELECT 1` inicial e o `SELECT * FROM sicar_import_schedule` falharam por conexão recusada | Novas conexões do pool passaram a funcionar 3 s depois; tudo que consulta o banco sob demanda (rotas, StatsCache, worker) funcionou — só os cron, carregados uma vez, ficaram vazios |
| 27/09 08:33:19 | 20 dias (até 17/10) | **Reboot da VPS após queda** (Postgres: "database system was interrupted; last known up at 08:31:16"). O pm2 ressuscitou a Hub a partir de `dump.pm2` salvo **antes da rotação de senha de 13/08** → o processo subiu com a senha antiga: **361 falhas de autenticação** no minuto do boot e 1 a cada 30 min depois (o StatsCache) | Nunca voltou nesse processo: `/api/auth/login` respondeu 500 o tempo todo; o guardião do enriquecimento não conseguiu logar, logo o worker ANM **não rodou de 27/09 a 21/10** |
| 17/10 20:31:12 | 3,4 dias (até 21/10) | **Reboot planejado** (pm2 parado às 20:23:44, Postgres desligado limpo). Mesmo mecanismo: ressurreição com env antigo; FATAL de senha no Postgres às 20:31:12,306, o segundo do boot | Idem. `GET /api/health` às 04:53 de 21/10 respondeu `database: disconnected, error: password…`; às 04:59 alguém reiniciou com o env correto e às 05:06 rodou `pm2 save` (o `dump.pm2` atual tem a senha vigente — hash idêntico ao `.env`) |

Desde 21/10 04:59 todos os boots carregaram os agendamentos (linhas "Scheduler SICAR inicializado: 27 rotina(s)" e "5 agendamento(s) de modulo" presentes; `proxima_execucao` atualizada 27 × 4 boots = 108 updates em `sicar_import_schedule`, exatamente o contador do Postgres). O diário IBAMA disparou hoje 03:30 UTC — o primeiro horário de disparo que um processo com cron carregado atravessou desde 14/08.

## Evidências (fonte a fonte)

1. **Log do pm2 (stdout)** — nos boots bons a sequência é `Verificando conexao…` → `Conexao com banco estabelecida` → `Banco de dados ja esta inicializado` → `Scheduler SICAR inicializado: 27 rotina(s)` → `[Module Scheduler] 5 agendamento(s)` → `Auto-resume` → `[routes] …` → `serving`. Nos boots de 14/08 06:00, 27/09 08:33 e 17/10 20:31 a linha `Verificando conexao…` é seguida **diretamente** por `[routes] auth registrado`: as cinco linhas que dependem do banco não existem. Nos mesmos processos não há nenhuma linha `Disparando:` ou `agendamento disparado`.
2. **Log do Postgres** (timestamps independentes):
   - 14/08 06:00:49,040 `received fast shutdown request` … 06:00:51,778 `ready to accept connections`; a Hub registrou `serving on port 5002` às 06:00:49.
   - 27/09 08:33:19 Postgres sobe com recuperação automática (queda); 08:33 **361 FATAL `password authentication failed for user "mavrion_api"`** em rajada a partir de 08:33:32 (pool + workers), depois 1 por meia hora até 21/10 04:59 (série diária: ~85/dia de 28/09 a 20/10; **zero** entre 15/08 e 26/09).
   - 17/10 20:31:12,306 FATAL de senha no segundo do boot.
3. **Resposta do próprio serviço**: `4:53:36 AM GET /api/health 503 … "database":"disconnected","error":"password…` (21/10, no log do pm2); `POST /api/auth/login 500` a cada 10 min (guardião) durante os processos de 27/09 e 17/10, e `200` nos demais.
4. **Contadores do Postgres** (`pg_stat_user_tables`, persistidos desde o desligamento limpo de 17/10): `sicar_import_schedule.n_tup_upd = 108` = 27 rotinas × 4 boots (21/10 04:59, 21/10 22:33, 22/10 03:23, 22/10 04:26). Se o boot de 17/10 tivesse carregado as rotinas seriam 135. `module_schedules.n_tup_upd = 22` = 5 × 4 boots + 2 updates do disparo de hoje.
5. **Timers em geral funcionavam**: no processo de 14/08→27/09 o StatsCache (setInterval de 30 min) rodou **2.117 vezes** e o sync SGB (setInterval de 7 dias) disparou em 11/09 06:00 — descarta travamento de event loop ou de timers do Node; o problema era a ausência das tarefas cron, não a sua execução.
6. **`dump.pm2`**: o `ecosystem.config.cjs` lê o `.env` e passa `DATABASE_URL` como env fixo do processo; o pm2 grava esse env no `dump.pm2` só em `pm2 save`. O `dump.pm2` e `dump.pm2.bak` atuais são de 21/10 05:06 e trazem a senha vigente (hash igual ao `.env`). Antes disso, qualquer reboot ressuscitava o processo com o env salvo na última vez em que alguém rodou `pm2 save` — que, pela série de FATAL, era anterior à rotação de 13/08.
7. **Código** (`hub-api/src/index.cjs`, fonte igual ao bundle): `nre()` captura o erro de conexão, loga e **retorna `false`, e o bootstrap ignora o retorno**; `initScheduler()` (`z9e` + `Fee`) só roda no boot e em PUT/POST de `/api/scheduler/modules/:id` e `/api/sicar/schedule/:id` — não há retry nem reload periódico; os `UPDATE … proxima_execucao` têm `.catch(() => {})`. Nenhum endpoint expõe quantas tarefas cron estão carregadas; `/api/health` só testa a conexão.

## Hipóteses descartadas (e como)

- **Bug do node-cron 4.2.1** (inlined no bundle, código idêntico ao npm): simulação completa 14/08→22/10 com relógio falso dispara todos os padrões; força bruta de `getNextMatch` a cada 17 min no período sem exceções. Há uma peculiaridade real (`getNextMatch` com dia-da-semana pula para anos à frente; o runner compensa com teto de 24 h) e a tolerância de atraso é de 1 s (um heartbeat que acorda ≥1 s atrasado pula a execução — explica os 7 de 9 disparos de sexta perdidos em 14/08 03:00, logo após o primeiro boot; a versão atual da biblioteca adicionou `missedExecutionTolerance` exatamente por isso), mas nada disso produz 44 dias de silêncio sem o aviso "missed execution".
- **Event loop travado / timers mortos**: item 5 acima.
- **Recarga frequente das tarefas** (que zeraria os heartbeats): só 2 PUTs em 13/08, nenhum depois.
- **Bundle diferente nos boots ruins**: mesmo caminho (`/var/www/mavrion-api/dist/index.cjs`) e mesmo arquivo de 13/08 20:59 até 21/10 22:33.

## O que não ficou explicado (limite do somente leitura)

- As mensagens de erro que esses boots deveriam ter gravado em stderr (`Erro ao inicializar banco de dados…`, `Erro ao inicializar scheduler SICAR…`, `[StatsCache] Erro no refresh…`) **não aparecem** em `mavrion-api-error-25.log` após 13/08, embora o stdout dos mesmos processos esteja lá. O comportamento do processo (health 503, login 500, FATAL no Postgres) prova que os erros ocorreram; a captura de stderr pelo pm2 nesses três processos é que falhou. Sem reproduzir um restart não dá para dizer se é um defeito do pm2 6.0.14 em modo cluster ou outra coisa. Consequência prática: o log de erro do pm2 **não é confiável** para detectar este tipo de falha.

## Consequências já ocorridas

- Base SICAR congelada em 07–14/08 (27 rotinas semanais sem rodar por 10 semanas); IBAMA embargos desde 09/08; ICMBio desde 14/08; PGFN trimestral de 05/10 perdida; sync SGB mensal só rodou em 11/09 porque é `setInterval`, não cron.
- Enriquecimento ANM parado de 27/09 a 21/10 (guardião sem login).
- Nenhum alerta: o `freshness-check` não monitora o scheduler interno, e `/api/health` não sabe quantas tarefas estão carregadas.

## O que esperar nas próximas horas (sem intervenção)

Com o processo atual (boot 22/10 04:26) os cron estão carregados: às **23/10 00:00 BRT (03:00 UTC)** devem disparar as 9 rotinas SICAR de sexta (AC, AL, AM, AP, BA, CE, DF, ES, GO) e iniciar a importação sequencial dessas UFs — a primeira reimportação SICAR desde agosto, com upsert de centenas de milhares de linhas por UF; às 00:30 BRT o diário IBAMA. Se o processo for reiniciado antes disso, o ciclo recomeça do boot. Qualquer novo reboot da VPS agora ressuscita com o env correto (dump de 21/10).

## Recomendações (não executadas; dependem de aprovação)

1. Fazer `initScheduler()` tentar de novo enquanto o banco não responde (ou recarregar quando a primeira conexão do pool tiver sucesso) e logar o número de tarefas carregadas.
2. Expor em `/api/health` (ou `/api/health/modules`) a contagem de tarefas cron ativas e a próxima execução, e incluir SICAR/IBAMA/ICMBio/PGFN no `freshness-check`, que hoje só olha os sidecars.
3. Procedimento operacional: depois de mudar `.env`, `pm2 restart --update-env` **e** `pm2 save`; nunca reiniciar Postgres e Hub no mesmo instante (ou reiniciar a Hub depois que o Postgres estiver pronto).
4. Verificar a captura de stderr do pm2 em modo cluster (ou passar a logar erros também no stdout).

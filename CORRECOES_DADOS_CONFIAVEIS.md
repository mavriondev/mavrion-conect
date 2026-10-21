# Correções de dados confiáveis (Connect + Hub)

Branch: `fix/dados-confiaveis` (base: `main`). Alterações em `server/enrichment/` foram autorizadas pelo dono.

## Princípio
Ausência em base pública **não** é ausência na realidade. O sistema só mostra "detectado/mapeado" (evidência positiva) ou "não detectado (não confirma ausência)" / "sem dado". Nada de zero, "Apto" ou valor inventado quando a fonte não respondeu.

## Problemas encontrados e corrigidos

### Críticos
- **Distância até água/energia** era calculada do centro da fazenda até os vértices de feições → erros de dezenas de km. Agora: amostragem de 100 pontos no interior + distância da borda da fazenda até a feição (0 se toca/atravessa). `server/lib/geo-medicao.ts`.
- **"Tem rio/energia"** vinha de raio regional. Agora: rio/lago = distância 0 (dentro/tocando); energia = até 1 km.
- **Score geo** tratava falta de dado como nota zero. Agora só pontua categorias conhecidas; sem dado suficiente (<50% do peso) a nota é `null` e a tela mostra "Nota indisponível". Ranking usa `NULLS LAST`.
- **NDVI inventado** ("Estimado (SoilGrids)") removido. Clima zerado como fallback removido.
- **Zoneamento ZARC** marcava "Apto"/risco "médio" por padrão; agora só com janela de plantio real. ZARC não entra mais na nota agro.
- **Produtividade Embrapa Agritec** rotulada como simulação com premissas fixas (não é previsão).

### Chuva / clima
- Open-Meteo agora com 10 anos; se >2% dos dias faltam, cai para NASA POWER (rotulado "apenas 1 ano").
- Antes a "precipitação média" era anual/12 exibida como mm → parecia baixa. Agora mostra mm/ano.
- Temperatura média = média dos meses (antes: ponto médio entre máx e mín).
- **Não verificado:** viés do ERA5 (~25 km) contra chuva real. Use `scripts/validar-chuva.mjs` (ver abaixo).

### Solo
- SoilGrids com média ponderada 0–5/5–15/15–30 cm (antes só 0–5 cm) e fonte rotulada como "estimativa de modelo 250 m, ponto central".

### Hub API (`hub-api/src/index.cjs`)
- Filtros de altitude/argila deixam de aceitar os valores-sentinela `-9999` / `-1` como dado real.
- **Rebuild necessário:** `cd hub-api && node build.mjs` (o `dist/` não foi regerado).

### Hub: altitude, declividade e argila (segunda rodada)
- Altitude: antes 5 pontos (centroide + cantos do bbox, podiam cair fora da fazenda). Agora até 17 pontos **dentro** do polígono (grade 4x4 filtrada por `ST_Intersects` + `ST_PointOnSurface`). Mín/máx são das amostras (podem subestimar extremos).
- Declividade: antes a maior inclinação entre qualquer par. Agora média da inclinação até o vizinho mais próximo a ≥ 90 m (resolução SRTM); `null` se a fazenda for pequena demais.
- Argila: leitura em ponto garantido dentro da fazenda (antes centroide) e média ponderada pela espessura das camadas (30/30/40; antes média simples).
- **SQL novo não testado aqui (sem PostGIS no sandbox).** Testar um lote pequeno no VPS antes de liberar tudo.
- Registros já processados **não** são recalculados automaticamente. Para reprocessar (opcional, os valores são derivados e recalculáveis): `UPDATE sicar_imoveis_cache SET alt_media = NULL WHERE alt_media IS NOT NULL;` e `UPDATE sicar_imoveis_cache SET argila_media = NULL;` (faça por UF/lotes e com backup).

## Ainda NÃO corrigido (decisões/validação)
- Hub: dois métodos de argila ainda coexistem (`argila_pct` SoilGrids e `argila_media` OpenGeoHub); o filtro prefere o OpenGeoHub.
- Viés de chuva do ERA5 (validar com valores reais).
- Uso do solo é o da classe no ponto central (MapBiomas via API), não a proporção de cada uso na área. A proporção real exige ler o raster do MapBiomas dentro do polígono (ideal: no Hub, como a argila).
- Camadas WFS (IBGE rodovia/ferrovia, INCRA assentamentos) não puderam ser testadas aqui; nomes de camada IBGE `BC100_Trecho_Rodoviario_L` / `BC100_Trecho_Ferroviario_L` são os esperados, e assentamentos só consulta se `INCRA_ASSENTAMENTOS_WFS_LAYER` estiver definida.
- Silos/armazéns, cobertura de celular e outorgas de água: sem fonte confiável integrada ainda.

## Ativos já cadastrados
Mantêm valores antigos até reanálise. O lote `/api/geo/batch-analyze` agora também seleciona ativos cujo `attributes_json.geoMetodo` ≠ `v2-interior` (máx. 50 por chamada — repetir até zerar). Flags antigas `false` continuam ambíguas e devem ser lidas como "não detectado".

## Como aplicar no Replit
1. Merge/checkout da branch; `npm install`.
2. `cd hub-api && node build.mjs` e reiniciar o Hub.
3. Rodar `/api/geo/batch-analyze` repetidamente para reanalisar.
4. Testar manualmente (não deu para testar aqui, sem rede): consulta SoilGrids multi-profundidade, WFS IBGE com `count=1000`, Overpass `out geom 400`, OpenTopoData com 100 pontos.
5. Validar chuva: preencher `scripts/validar-chuva.exemplo.json` (`chuvaRealMmAno`) e rodar `node scripts/validar-chuva.mjs scripts/validar-chuva.exemplo.json`.

## Testes
- Novos (passam): `npx tsx server/lib/__tests__/geo-medicao.test.ts`, `.../agro-solo-clima.test.ts`.
- `tsc`: 6 erros de base, idênticos na `main` (xlsx indisponível no sandbox + antigos). Nenhum novo.
- 15 dos 28 testes existentes exigem `DATABASE_URL` — rodar no Replit.

## Terceira rodada: verificações da terra com estados de confiança
Aprovado: sobreposições, uso do solo, NDVI, logística, APP/RL, histórico e estados de confiança. Removidos do escopo a pedido: preço de referência, dossiê em PDF e checklist de visita.

**Corrigido nos módulos existentes (mesmo princípio: falha de fonte não é ausência):**
- `due-diligence-fundiaria.ts`: cada camada (TI, quilombola, UC, assentamento opcional) registra `consultada`/`falhou`; se algo falhou e nada foi achado, o risco é `indeterminado` (antes: `nenhum`). Áreas sem geometria ou com cálculo de interseção falho ficam "a verificar" (antes: sumiam). Associação feição↔área por `featKey` (antes por posição, desalinhava). Erro do PostGIS agora propaga (antes virava 0 ha). Resultado com falha não vai para cache.
- `sentinel.ts`: sem valores inventados (0,5/0/1/0,1 quando faltava dado); pixels sem observação saem da média (antes contavam como NDVI 0); estatística no polígono (antes caixa envolvente com vizinhos); "data da imagem" virou período do composto.
- `mapbiomas.ts`: `alertasConsultados` e `alertasEscopo` (propriedade × região de ~4 km); tela não mostra mais "Sem alertas" quando a consulta falhou.
- `lib/embrapa.ts` removido (sem importadores; tinha `|| 0`).

**Novo:**
- `server/lib/confianca-dados.ts`: estado (`confirmado` humano / `indicado` por fonte / `sem_dado`) × achado (`detectado` / `nao_detectado` / `indeterminado`), validade por tipo, projeção pública (só faixas, nunca sobreposição/CAR/local) — base do site de fazendas.
- `server/lib/verificacoes-terra.ts` + `server/routes/verificacoes.ts`: executa sobreposições, alertas, uso do solo, referência de RL (só biomas com 20% inequívocos), NDVI, rodovia/ferrovia mais próximas e APP mínima (faixa de 30 m dos cursos d'água do IBGE).
- Tabela `asset_verificacoes` (criada sozinha no startup; histórico append-only). Rotas: `GET /api/assets/:id/verificacoes`, `GET .../historico`, `POST .../executar`, `POST .../:chave/confirmar`.
- Cartão "Verificações da terra" na aba Due Diligence do ativo, com confirmação manual (vendedor/documento/visita) e aviso de divergência quando uma fonte nova contradiz uma confirmação.
- Testes novos: `confianca-dados.test.ts`, `risco-sobreposicao.test.ts` (rodar com `DATABASE_URL` definida).

**Para ativar:** definir `SENTINEL_HUB_CLIENT_ID/SECRET` (NDVI) e as credenciais do MapBiomas já usadas; opcional `INCRA_ASSENTAMENTOS_WFS_LAYER`. A tabela nova é criada no próximo start.

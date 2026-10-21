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

## Ainda NÃO corrigido (decisões/validação)
- Hub: altitude vem de 5 pontos (centroide + cantos do bbox, que podem cair fora da fazenda) e "declividade" = maior inclinação entre pares.
- Hub: argila no pixel do centroide, média simples de 3 camadas, e dois métodos coexistindo.
- Viés de chuva do ERA5 (validar com valores reais).
- `lib/embrapa.ts` `getDadosClimaticos` é código morto com `|| 0`.

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

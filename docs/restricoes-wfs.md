# Consultas de restrições fundiárias e ambientais

## Diagnóstico e fontes (22/10/2026)

`verificacoes-terra.ts` usa `consultarSobreposicoes` em
`due-diligence-fundiaria.ts`. As consultas de TI, quilombolas e UC agora usam
`restricoes-wfs.ts`. Não usam o Hub nem cópias locais sem procedência.

Os endpoints antigos apresentaram falha de certificado (FUNAI) e resolução de
nome (INCRA e ICMBio). Os logs vivos da VPS confirmaram `fetch failed` nas três
consultas da fazenda de teste, enquanto o NDVI já respondia.

| Consulta | Serviço oficial | Camada | Atualidade e limites |
|---|---|---|---|
| TI | `https://cmr.funai.gov.br/geoserver/ows` | `CMR-PUBLICO:lim_terra_indigena_a` | CMR público da própria FUNAI; sem data única de atualização do conjunto. `dt_cadastro` existe por feição. Só delimitações publicadas. |
| Quilombolas | `https://geoservicos.ibge.gov.br/geoserver/ows` | `CGMAT:qg_2022_620_territorioquilombola__v02` | Republicação oficial IBGE de delimitações INCRA, recorte de 2022. Não é cadastro em tempo real nem cobre todas as comunidades. |
| UC | `https://geoservicos.inde.gov.br/geoserver/ows` | `MMA:cnuc_26_07_31` | Republicação oficial MMA/CNUC pela INDE, julho/2026; inclui UCs federais, estaduais e municipais, não atualizações posteriores. |

As camadas constavam dos respectivos `GetCapabilities`. As consultas
`GetFeature` recuperaram polígonos e nomes reais em controles positivos de cada
fonte. A camada CNUC de março/2026 foi descartada por ter campos genéricos
`n1..n32`; a de julho/2026 tem `nome_uc`, `categoria` e `grupo`.

## Parâmetros e segurança de interpretação

- WFS 2.0, `typeNames`, JSON, BBOX e saída em `CRS:84` (longitude, latitude).
  Não presumir que a geometria se chama `geom`.
- Páginas de 200 feições, até 10 páginas, orçamento total de 45 segundos.
- Ordenação explícita: `co_funai`, `cd_tq`, `ogc_fid`, respectivamente. O IBGE
  retorna HTTP 400 com `startIndex=0` **sem** `sortBy`, inclusive em BBOX vazio.
  Com ordenação, foram verificadas duas páginas distintas de controle positivo.
- HTTP inválido, XML de exceção com HTTP 200, JSON sem `FeatureCollection`,
  atributos incompatíveis, falta de polígono, repetição de página, contagem
  inconsistente e limite excedido são falha, nunca resultado vazio válido.
- Uma falha posterior descarta páginas parciais. Falhas não são armazenadas
  no cache. A nova chave separa fontes antigas e usa BBOX exato (ou ponto e raio),
  sem arredondar fazendas vizinhas para a mesma chave.
- Cada resultado informa origem, endpoint, camada, data-base, consulta e limites.
  Indisponibilidade resulta em `sem_dado` / `indeterminado`.
  `nao_detectado` significa apenas não detectado no recorte consultado.
- A detecção inicial por BBOX não prova sobreposição. O fluxo existente calcula
  a interseção do polígono da fazenda com PostGIS.
- Assentamentos não foram substituídos por pontos: continuam com sua consulta
  INCRA/configuração separada, fora desta correção.

## Verificação executada

Em 22/10/2026, às 02:07 UTC, o código corrigido foi executado via stdin na VPS,
contra **somente a fazenda de teste de Patos de Minas (ativo 2)**, usando o
polígono e a organização cadastrados em produção:

- TI: fonte respondeu; não detectado no recorte.
- Quilombolas: fonte respondeu; não detectado no recorte de 2022.
- UC: fonte respondeu; não detectado no recorte de julho/2026.

O diagnóstico utilizou `PGOPTIONS="-c default_transaction_read_only=on"` e
`usarCache: false`. Não gravou verificações, não alterou dados, não processou
outras fazendas e não substituiu/reiniciou a aplicação publicada. Os resultados
antigos no histórico permanecem intactos; o app receberá a correção após a
integração e atualização normal da versão.

### Diagnóstico reproduzível

No ambiente devidamente configurado, informar exatamente um ativo TERRA:

```sh
PGOPTIONS="-c default_transaction_read_only=on" \
  npx tsx scripts/validar-restricoes-wfs.ts <id-da-fazenda>
```

O script retorna código de saída diferente de zero se qualquer uma das três
fontes estiver indisponível. Não chama NDVI, uso do solo ou enriquecimentos.

### Checagens locais aprovadas

```sh
npm run check
npx tsx server/lib/__tests__/restricoes-wfs.test.ts
npx tsx server/lib/__tests__/verificacoes-sobreposicoes.test.ts
npx tsx server/lib/__tests__/risco-sobreposicao.test.ts
npx tsx server/lib/__tests__/uso-solo-e-wfs.test.ts
```

Os testes cobrem fontes/atributos, eixos, ordenação, paginação, limite,
indisponibilidade, exceção XML, resposta incompleta e a conversão real de falha
para `sem_dado` no fluxo de verificações. O workflow iniciou sem erros e a tela
inicial foi conferida; não houve alteração de interface.

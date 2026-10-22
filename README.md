# Mavrion Connect

Gestão e análise de ativos rurais e minerários. CRM, SDR, Vitrine, Matching e operações com fundos não fazem parte do escopo atual.

## Desenvolvimento

- Instalar dependências: `npm ci`.
- Executar: `npm run dev` (porta 5000).
- Conferir tipos: `npm run check`.
- Gerar o build: `npm run build`.
- Configurar banco de dados e credenciais exclusivamente por variáveis de ambiente, nunca no código ou no Git.

Não há credenciais de administrador documentadas neste repositório.

## Estrutura e produção

| Local | Conteúdo |
|---|---|
| `client/`, `server/`, `shared/` | Fontes do Mavrion Connect |
| `dist/index.cjs`, `dist/public/` | Build publicado do Connect |
| `hub-api/src/index.cjs`, `hub-api/build.mjs` | Fonte recuperado e build reproduzível da Hub API |
| `hub-api/reference/` | Referências TypeScript parciais; não substituem o fonte recuperado |
| `vps-rotinas/`, `snapshot/` | Rotinas e documentação operacionais preservadas da VPS |

O Connect utiliza PM2 em `/var/www/mavrion-conect` (`mavrion-conect`, porta 5000).
A Hub API utiliza `/var/www/mavrion-api` (`mavrion-api`, porta 5002).

Não reconstruir produção a partir de fontes antigos encontrados na VPS. Gerar e validar o build do Connect no ambiente de desenvolvimento e conferir seus hashes após a transferência. Para a Hub, executar `node build.mjs` no diretório `fonte/`, validando antes de substituir o bundle em execução.

Ao alterar o `.env` do Connect, reiniciar somente seu serviço com:

```sh
pm2 restart ecosystem.config.cjs --only mavrion-conect --update-env
```

O auto-deploy por cron permanece desativado por orientação do proprietário.

## Verificações de dados

As correções e os limites dos métodos estão descritos em `CORRECOES_DADOS_CONFIAVEIS.md`.
O histórico de verificações é persistido em `asset_verificacoes`. Falha de consulta ou falta de credencial significa **sem dado**, não ausência de ocorrência.

### Sentinel / NDVI

Criar um cliente OAuth no [Copernicus Data Space](https://shapps.dataspace.copernicus.eu/dashboard/#/account/settings), em **User Settings → OAuth clients**. O cliente é usado no servidor, não como SPA.

- `SENTINEL_HUB_CLIENT_ID`
- `SENTINEL_HUB_CLIENT_SECRET`

O NDVI consulta Sentinel-2 L2A dentro do polígono, usando um composto dos últimos 30 dias. Não representa produtividade nem comprova uso agrícola.

### MapBiomas Alerta

Utilizar uma conta com e-mail confirmado na [plataforma MapBiomas Alerta](https://plataforma.alerta.mapbiomas.org/sign-up):

- `MAPBIOMAS_EMAIL`
- `MAPBIOMAS_PASSWORD`

Secrets do Replit e variáveis da VPS são configurações separadas. Nunca publicar valores, tokens, sessões, arquivos `.env` ou backups de configuração.

## Limites operacionais

A validação dos novos cálculos do Hub ficou limitada a 200 imóveis de SP. Não iniciar os workers globais nem ampliar o reprocessamento sem nova autorização explícita do proprietário.

Os históricos locais do Replit e o histórico auditado do GitHub não devem ser unidos em um push. Atualizações do GitHub devem partir da `main` remota vigente, sem force-push nem reintrodução da ancestralidade antiga.

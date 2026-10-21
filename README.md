# Mavrion — cópia da VPS para análise

Snapshot de **21/10/2026**, preparado para compartilhar o código com o Claude.
Esta é a nova **`main`, com um único commit inicial sem ancestrais**, substituindo o conteúdo e o histórico anteriormente publicados nas branches controláveis do repositório. A branch temporária de snapshot foi removida. O repositório GitHub foi mantido como entidade; não houve implantação.

## Comece por aqui

| Local | Conteúdo | Limitação |
|---|---|---|
| `client/`, `server/`, `shared/` | Fontes do Mavrion Connect encontrados na VPS | Antigos/incompletos em relação ao build em execução |
| `dist/index.cjs`, `dist/public/` | Builds publicados do Connect, capturados da VPS | Cópias para análise; valores sensíveis foram removidos quando encontrados |
| `hub-api/src/index.cjs` | Fonte recuperado que já existia em `/var/www/mavrion-api/fonte/` | JavaScript desminificado, incluindo dependências; não é o TypeScript original |
| `hub-api/dist/` | Builds publicados da Hub API | Capturados, não reconstruídos |
| `hub-api/reference/` | Fontes TypeScript parciais/antigos da Hub API | Referência histórica; não usar para reconstruir produção |
| `hub-api/migrations/` | Migrações disponíveis no fonte recuperado | Apenas arquivos; não foram executadas |
| `vps-rotinas/` | Rotinas sidecar encontradas na VPS | Nenhuma rotina foi executada |
| `snapshot/manual-operations/` | Scripts operacionais sanitizados, como texto inerte | Referência, não automação habilitada |
| `snapshot/provenance.json` | Origem e SHA-256 original/publicado por arquivo | `modified: true` identifica diferenças da cópia |
| `snapshot/SHA256SUMS` | Checksums de todos os arquivos publicados, exceto o próprio manifesto | Verificar com `sha256sum -c snapshot/SHA256SUMS` |

**Não assuma que recompilar os fontes desta branch reproduz o site atual.**
O Connect e a Hub API executam `dist/index.cjs` na VPS. Os fontes disponíveis e os bundles não têm equivalência comprovada.
Nenhuma alteração do workspace Replit ou do trabalho em andamento no módulo de jazidas foi misturada a esta cópia.

## O que foi excluído

- `.env` reais, senhas, tokens, chaves, sessões e cookies.
- Banco de dados, dumps, planilhas de leads, uploads e documentos de clientes.
- Logs operacionais, caches, dependências instaladas, backups e repositórios Git aninhados.
- Outros projetos da VPS.
- Sourcemaps e arquivos antigos de frontend não referenciados pelo build publicado.
- Documentos operacionais privados e históricos de deploy.

Os exemplos `.env.example` contêm **somente nomes de variáveis, sem valores**.
Credenciais fixas e registros de exemplo identificados em código/scripts foram substituídos por marcadores. Essas alterações existem somente nesta cópia, não na VPS.
Os nomes com hash dos bundles foram mantidos para preservar referências internas; o SHA-256 efetivo da cópia está no manifesto.

## Verificações e limitações

- Checksums dos arquivos de origem conferidos antes, durante e depois da captura.
- Auditoria com Gitleaks 8.18.2, inspeção de literais JavaScript/TypeScript e busca exata de credenciais de configuração em um processo restrito, sem exportar seus valores.
- As ocorrências reais identificadas foram removidas. Os 14 alertas restantes do Gitleaks foram classificados como coincidências dentro de dados base64 incorporados por bibliotecas; ver `snapshot/security-audit.json`.
- Sintaxe dos bundles CJS e das rotinas Node validada.
- `npm run check` da cópia da VPS **não passa**. O teste usou dependências já disponíveis no ambiente isolado, não uma instalação reproduzida do lockfile. Ver `snapshot/typecheck-output.txt`; não houve tentativa de corrigir ou atualizar os fontes.
- Algumas imagens importadas pelos fontes estão em `attached_assets`, que foi excluído. Os assets usados pelos builds publicados foram preservados.
- Nenhum build, pacote, migração, deploy, restart ou alteração de dados foi executado na VPS.
- Esta auditoria cobre a árvore atual. A reescrita das referências controláveis não garante a eliminação física de objetos antigos em caches, forks, clones ou referências de pull requests do GitHub. Credenciais anteriormente expostas precisam ser revogadas/trocadas independentemente do reset.

## Sugestão de pedido ao Claude

> Analise esta branch como um snapshot sanitizado da VPS, não como um projeto pronto para deploy. Comece pelo README, pela proveniência e pelos erros de tipos. Compare os fontes disponíveis com os bundles e aponte lacunas, riscos e melhorias para o módulo de jazidas. Separe fatos observados de hipóteses. Não proponha reconstruir ou substituir produção a partir de fontes antigos sem primeiro recuperar e validar a versão correta. Não invente credenciais nem execute rotinas que alterem dados.

## Estado operacional

O auto-deploy do Connect por cron foi desativado com autorização do proprietário, para impedir uma implantação acidental durante este trabalho. As outras rotinas foram preservadas. Esta branch não contém Actions nem outro mecanismo de deploy automático.

O backup verificado do Git anterior e as instruções de recuperação foram mantidos em diretório restrito, fora deste repositório e do novo histórico.

## Para quem tinha um clone antigo

Faça uma nova clonagem do repositório. Não faça merge, pull com históricos não relacionados ou push de branches/tags antigas: isso pode reintroduzir o conteúdo e o histórico removidos. Preserve trabalho local não publicado em cópia privada e reaplique somente mudanças deliberadamente revisadas, sem importar a ancestralidade antiga.

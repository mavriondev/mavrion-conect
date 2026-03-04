# B2B SDR + CRM + Matching MVP

Sistema completo contendo SDR, CRM Kanban e Módulo de Matching.

## Executando Localmente no Replit
O sistema está otimizado para o Replit. Clique em "Run" e o banco de dados Postgres gerenciado será usado automaticamente. 
A autenticação baseada em Passport e as rotas já estão integradas.

## Autenticação Padrão
O sistema fará o seed de um usuário admin padrão na primeira inicialização:
- **Usuário:** admin
- **Senha:** admin

## Executando na VPS com Docker
O sistema foi configurado com um `docker-compose.yml` para facilitar o deploy em qualquer VPS com Docker Compose.

1. Clone o repositório em sua VPS.
2. Certifique-se de ter Docker e Docker Compose instalados.
3. Copie o arquivo `.env.example` para `.env` (se existir) ou apenas defina as variáveis no `docker-compose.yml`.
4. Execute o comando:
   ```bash
   docker-compose up -d --build
   ```
5. Acesse a aplicação na porta 5000.

O `docker-compose.yml` inicia os serviços Postgres, Redis, e o backend Node.
Para a funcionalidade de Workers (Scraping/BullMQ), você poderá acionar um processo ou serviço separado utilizando os mesmos módulos posteriormente.

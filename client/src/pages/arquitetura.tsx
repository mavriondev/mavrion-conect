import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const NAVY = "#1a365d";

const DOC_STYLES = `
  * { box-sizing: border-box; }
  .doc-page {
    width: 794px; background: #fff; padding: 64px 56px 72px;
    font-family: 'Georgia', 'Times New Roman', serif; color: #1a1a1a;
    line-height: 1.75; font-size: 13px;
  }
  .doc-cover {
    min-height: 500px; display: flex; flex-direction: column;
    align-items: center; justify-content: center; text-align: center;
    border: 2px solid ${NAVY}; padding: 80px 48px; margin-bottom: 48px;
  }
  .doc-cover h1 {
    font-size: 32px; font-weight: 700; color: ${NAVY};
    margin: 0 0 8px; letter-spacing: -0.5px;
  }
  .doc-cover .subtitle {
    font-size: 16px; color: #4a5568; font-style: italic; margin-bottom: 32px;
  }
  .doc-cover .meta {
    font-size: 11px; color: #718096; line-height: 1.8;
  }
  .doc-section { margin-bottom: 36px; page-break-inside: avoid; }
  .doc-section h2 {
    font-size: 19px; font-weight: 700; color: ${NAVY};
    border-bottom: 2px solid ${NAVY}; padding-bottom: 6px;
    margin: 0 0 16px;
  }
  .doc-section h3 {
    font-size: 15px; font-weight: 700; color: #2d3748;
    margin: 20px 0 10px;
  }
  .doc-section p {
    margin: 0 0 12px; text-align: justify;
  }
  .doc-section ul, .doc-section ol {
    margin: 8px 0 14px; padding-left: 24px;
  }
  .doc-section li { margin-bottom: 5px; line-height: 1.7; }
  .doc-section li::marker { color: ${NAVY}; }
  .doc-section strong { font-weight: 700; color: #1a202c; }
  .doc-section em { font-style: italic; color: #4a5568; }
  table.doc-table {
    width: 100%; border-collapse: collapse; margin: 12px 0 20px; font-size: 11.5px;
  }
  table.doc-table th {
    background: #edf2f7; padding: 8px 10px; text-align: left;
    font-weight: 700; border: 1px solid #cbd5e0; color: #2d3748; font-size: 11px;
  }
  table.doc-table td {
    padding: 6px 10px; border: 1px solid #e2e8f0; vertical-align: top;
  }
  table.doc-table tr:nth-child(even) td { background: #f7fafc; }
  .severity-red { color: #c53030; font-weight: 700; }
  .severity-yellow { color: #b7791f; font-weight: 700; }
  .severity-green { color: #276749; font-weight: 700; }
  .flow-box {
    background: #f7fafc; border: 1px solid #e2e8f0; border-radius: 6px;
    padding: 16px 20px; margin: 12px 0 20px; font-family: 'Courier New', monospace;
    font-size: 12px; line-height: 2; color: #2d3748; white-space: pre-wrap;
  }
  .gap-card {
    border-left: 4px solid; padding: 12px 16px; margin: 12px 0;
    background: #f7fafc; border-radius: 0 6px 6px 0;
  }
  .gap-card.red { border-color: #c53030; }
  .gap-card.yellow { border-color: #d69e2e; }
  .gap-card.green { border-color: #38a169; }
  .gap-card .gap-title { font-weight: 700; margin-bottom: 4px; }
  .gap-card p { margin: 4px 0; font-size: 12px; }
`;

const today = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });

function buildDocHtml(): string {
  return `
<style>${DOC_STYLES}</style>

<div class="doc-page">
  <div class="doc-cover">
    <h1>Mavrion Connect</h1>
    <div class="subtitle">Documento de Arquitetura — Mapa de Conexões entre Módulos</div>
    <div class="meta">
      Versão 1.0 — ${today}<br/>
      Documento interno para análise de integrações e oportunidades de melhoria<br/>
      Plataforma de Deal Origination — Real Estate, M&A & Mineração
    </div>
  </div>

  <!-- 1. VISÃO GERAL -->
  <div class="doc-section">
    <h2>1. Visão Geral da Plataforma</h2>
    <p>O <strong>Mavrion Connect</strong> é uma plataforma B2B de <em>deal origination</em> voltada para operações de fundos imobiliários, M&A e mineração. A plataforma centraliza todo o ciclo de vida de uma oportunidade de negócio — desde a prospecção inicial de empresas e ativos até a geração de propostas comerciais e contratos.</p>
    <p>A arquitetura é full-stack (React + Express + PostgreSQL) com autenticação por sessão, multi-tenancy por organização, sistema de notificações SSE em tempo real, e um portal público para investidores.</p>
    <p>O sistema possui <strong>14 módulos principais</strong> que se comunicam entre si através de chaves estrangeiras no banco de dados, endpoints da API, ações do frontend e eventos de notificação.</p>
  </div>

  <!-- 2. MAPA DE MÓDULOS -->
  <div class="doc-section">
    <h2>2. Mapa de Módulos</h2>
    <table class="doc-table">
      <thead>
        <tr><th>#</th><th>Módulo</th><th>Rota Frontend</th><th>Rota Backend</th><th>Descrição</th></tr>
      </thead>
      <tbody>
        <tr><td>1</td><td><strong>Dashboard</strong></td><td>/</td><td>crm.ts (stats)</td><td>Painel com KPIs: leads, deals, ativos, conversão</td></tr>
        <tr><td>2</td><td><strong>Prospecção CNPJ</strong></td><td>/prospeccao</td><td>prospeccao.ts</td><td>Busca e importação de empresas via CNPJ com enriquecimento automático</td></tr>
        <tr><td>3</td><td><strong>M&A Deals</strong></td><td>/ma</td><td>matching.ts</td><td>Painel de fusões e aquisições</td></tr>
        <tr><td>4</td><td><strong>Portal ANM</strong></td><td>/anm</td><td>geo.ts</td><td>Consulta ao Portal ANM (Agência Nacional de Mineração) para processos minerários</td></tr>
        <tr><td>5</td><td><strong>Prospecção Rural</strong></td><td>/geo-rural</td><td>prospeccao.ts</td><td>Consulta SICAR para propriedades rurais e CAR</td></tr>
        <tr><td>6</td><td><strong>Fila SDR</strong></td><td>/sdr</td><td>sdr.ts</td><td>Fila de qualificação de leads com regras de scoring</td></tr>
        <tr><td>7</td><td><strong>Empresas</strong></td><td>/empresas</td><td>companies.ts</td><td>CRM de empresas com enriquecimento CNPJ, contatos verificados, notas de pesquisa</td></tr>
        <tr><td>8</td><td><strong>CRM Kanban</strong></td><td>/crm</td><td>crm.ts</td><td>Board Kanban com pipelines INVESTOR e ASSET, deals com prioridade/probabilidade</td></tr>
        <tr><td>9</td><td><strong>Propostas</strong></td><td>/propostas</td><td>commercial.ts</td><td>Templates e geração de propostas comerciais com variáveis dinâmicas + PDF</td></tr>
        <tr><td>10</td><td><strong>Contratos</strong></td><td>/contratos</td><td>commercial.ts</td><td>Templates e geração de contratos formais com variáveis dinâmicas + PDF</td></tr>
        <tr><td>11</td><td><strong>Ativos</strong></td><td>/ativos</td><td>assets.ts</td><td>Portfolio de ativos (Terras, Minas, Negócios, FII/CRI, Agro, Desenvolvimento)</td></tr>
        <tr><td>12</td><td><strong>Matching</strong></td><td>/matching</td><td>matching.ts</td><td>Motor de matching ativo↔investidor com scoring por tipo, ticket e localização</td></tr>
        <tr><td>13</td><td><strong>Portal Investidor</strong></td><td>/portal-admin + /portal</td><td>portal.ts</td><td>Portal público de ativos com listings, inquiries e landing pages exclusivas</td></tr>
        <tr><td>14</td><td><strong>Relatórios</strong></td><td>/relatorios</td><td>system.ts</td><td>Analytics avançados: funil, aging, conversão, atividades (audit log)</td></tr>
      </tbody>
    </table>
    <p><strong>Módulos de suporte:</strong> Conectores (integração ANM/SICAR/CNPJA), Configurações (org settings, lead rules), Usuários (gestão de equipe), Error Reports (captura automática de bugs), Auditoria (log de todas as ações).</p>
  </div>

  <!-- 3. TABELA DE CONEXÕES -->
  <div class="doc-section">
    <h2>3. Matriz de Conexões entre Módulos</h2>
    <p>A tabela abaixo detalha como cada módulo se comunica com os demais, incluindo o mecanismo de conexão utilizado.</p>
    <table class="doc-table">
      <thead>
        <tr><th>De → Para</th><th>Mecanismo</th><th>Descrição da Conexão</th></tr>
      </thead>
      <tbody>
        <tr><td><strong>Prospecção → Empresas</strong></td><td>API (POST)</td><td>Importa empresa com dados CNPJ enriquecidos para o banco de empresas</td></tr>
        <tr><td><strong>Prospecção → Leads (SDR)</strong></td><td>API (POST)</td><td>Cria lead automático na fila SDR ao importar empresa</td></tr>
        <tr><td><strong>ANM → Ativos</strong></td><td>API (POST)</td><td>Importa processo minerário como ativo tipo MINA</td></tr>
        <tr><td><strong>SICAR → Ativos</strong></td><td>API (POST)</td><td>Importa propriedade rural como ativo tipo TERRA</td></tr>
        <tr><td><strong>SDR → CRM</strong></td><td>Frontend Action</td><td>Botão "Promover para Deal" cria deal vinculado à empresa e ativo</td></tr>
        <tr><td><strong>SDR → Empresas</strong></td><td>FK (company_id)</td><td>Lead referencia a empresa no banco</td></tr>
        <tr><td><strong>CRM → Empresas</strong></td><td>FK (company_id)</td><td>Deal vinculado a uma empresa</td></tr>
        <tr><td><strong>CRM → Ativos</strong></td><td>FK (asset_id)</td><td>Deal pode referenciar um ativo específico</td></tr>
        <tr><td><strong>Matching → CRM</strong></td><td>Frontend Action</td><td>"Aceitar Match" cria deal no pipeline INVESTOR com labels e score</td></tr>
        <tr><td><strong>Matching → Ativos</strong></td><td>FK (asset_id)</td><td>Sugestão referencia o ativo avaliado</td></tr>
        <tr><td><strong>Matching → Investidores</strong></td><td>FK (investor_id)</td><td>Sugestão referencia o perfil do investidor</td></tr>
        <tr><td><strong>Propostas → Empresas</strong></td><td>FK + Variáveis</td><td>Preenche variáveis {{empresa.*}} com dados da empresa selecionada</td></tr>
        <tr><td><strong>Propostas → Ativos</strong></td><td>FK + Variáveis</td><td>Preenche variáveis {{ativo.*}} com dados do ativo selecionado</td></tr>
        <tr><td><strong>Propostas → Investidores</strong></td><td>FK + Variáveis</td><td>Preenche variáveis {{investidor.*}} com dados do investidor</td></tr>
        <tr><td><strong>Contratos → Empresas</strong></td><td>FK + Variáveis</td><td>Mesma lógica de preenchimento que propostas</td></tr>
        <tr><td><strong>Contratos → Ativos</strong></td><td>FK + Variáveis</td><td>Mesma lógica de preenchimento que propostas</td></tr>
        <tr><td><strong>Portal → Ativos</strong></td><td>Dados Manuais</td><td>Admin cria listing baseado em um ativo (sem FK direta)</td></tr>
        <tr><td><strong>Portal → Inquiries</strong></td><td>API (POST público)</td><td>Visitante público envia interesse, armazenado em portal_inquiries</td></tr>
        <tr><td><strong>Landing Pages → Inquiries</strong></td><td>API (POST público)</td><td>Visitante envia interesse pela landing page exclusiva</td></tr>
        <tr><td><strong>Auditoria → Todos</strong></td><td>DB Insert</td><td>Ações em deals, leads, empresas geram registro no audit_logs</td></tr>
        <tr><td><strong>Notificações → CRM/Portal</strong></td><td>SSE</td><td>Eventos de stage change, inquiry, match, due date geram notificação real-time</td></tr>
        <tr><td><strong>Dashboard → CRM/SDR/Ativos</strong></td><td>API Agregação</td><td>Agrega contagens e métricas de deals, leads e ativos</td></tr>
        <tr><td><strong>Relatórios → Auditoria</strong></td><td>API (GET)</td><td>Tab "Atividades" consome audit_logs para feed de atividades</td></tr>
        <tr><td><strong>Conectores → Cache</strong></td><td>DB (raw_ingests)</td><td>Resultados de APIs externas cacheados com TTL por namespace</td></tr>
        <tr><td><strong>Empresas → Enriquecimento</strong></td><td>API Externas</td><td>Web search + scraping de site para dados de contato, SEO, redes sociais</td></tr>
      </tbody>
    </table>
  </div>

  <!-- 4. FLUXO DE DADOS -->
  <div class="doc-section">
    <h2>4. Fluxo de Dados Completo — Ciclo de Vida de um Deal</h2>
    <p>O fluxo principal da plataforma segue o ciclo de vida de uma oportunidade de negócio, desde a prospecção até o fechamento:</p>

    <h3>4.1 Captação de Empresas</h3>
    <div class="flow-box">Prospecção CNPJ ──→ Empresa criada no banco ──→ Lead criado na Fila SDR
Portal ANM      ──→ Ativo MINA importado
SICAR/GeoRural  ──→ Ativo TERRA importado</div>
    <p>A empresa é encontrada via busca CNPJ (ReceitaWS/CNPJA). Ao importar, o sistema cria a empresa com dados cadastrais e, automaticamente, uma lead na fila SDR para qualificação.</p>

    <h3>4.2 Qualificação (SDR)</h3>
    <div class="flow-box">Fila SDR: Lead [novo] ──→ [qualificado] ──→ [promovido]
                              │                        │
                              └── Descarte             └── Cria Deal no CRM</div>
    <p>O SDR avalia cada lead com base em regras de scoring configuráveis. Leads qualificadas são promovidas a Deal no CRM, mantendo o vínculo com a empresa de origem.</p>

    <h3>4.3 Pipeline CRM</h3>
    <div class="flow-box">Pipeline INVESTOR: Prospecção → Análise → LOI → Due Diligence → Fechamento
Pipeline ASSET:    Captação  → Val.Docs → Análise → LOI → Fechamento

Deal vincula: empresa_id + asset_id (opcional) + investidor (via matching)</div>
    <p>O CRM Kanban suporta dois pipelines independentes. Cada deal é rastreado com prioridade, probabilidade, prazo, etiquetas, anexos e comentários. Mudanças de etapa geram registros de auditoria e notificações SSE.</p>

    <h3>4.4 Matching Engine</h3>
    <div class="flow-box">Motor de Matching:
  Para cada ATIVO × INVESTIDOR:
    ├── Comparar tipo (TERRA, MINA, etc.)
    ├── Comparar ticket (priceAsking vs ticketMin/Max)
    ├── Comparar localização (estado vs regiões de interesse)
    └── Gerar score + justificativa

  Match aceito ──→ Cria Deal no pipeline INVESTOR com labels ["Matching", "Score X%"]</div>

    <h3>4.5 Proposta e Contrato</h3>
    <div class="flow-box">Template (variáveis) + Dados (empresa/ativo/investidor) ──→ Proposta gerada
Proposta enviada por email (Resend API) ──→ Status: draft → generated → sent

Template Contrato + Dados ──→ Contrato gerado ──→ PDF exportável</div>
    <p>Propostas e contratos são gerados a partir de templates com variáveis dinâmicas (grupos: Empresa, Ativo, Investidor, Minha Empresa, Data). O conteúdo HTML é renderizado e exportado como PDF profissional.</p>

    <h3>4.6 Portal do Investidor</h3>
    <div class="flow-box">Admin cria Listing ──→ Portal Público exibe ativos
Visitante vê ativo ──→ Envia inquiry (nome, email, empresa)
                       ──→ Notificação SSE para equipe

Landing Page exclusiva (/lp/:slug) ──→ Mesmo fluxo de inquiry</div>
  </div>

  <!-- 5. ANÁLISE DE DESCONEXÕES -->
  <div class="doc-section">
    <h2>5. Análise de Desconexões e Gaps de Integração</h2>
    <p>A análise abaixo identifica pontos onde módulos que deveriam se comunicar não o fazem, ou onde a integração é parcial. Cada gap é classificado por severidade:</p>

    <div class="gap-card red">
      <div class="gap-title"><span class="severity-red">ALTA</span> — Inquiries do Portal/Landing Pages não convertem para Lead ou Deal</div>
      <p><strong>Problema:</strong> Quando um visitante público envia interesse pelo Portal ou por uma Landing Page, a inquiry é armazenada na tabela <em>portal_inquiries</em>, mas não existe nenhum mecanismo para converter essa inquiry em uma Lead (SDR) ou Deal (CRM). Os dados ficam órfãos — a equipe precisa re-digitar manualmente as informações para dar seguimento comercial.</p>
      <p><strong>Impacto:</strong> Perda potencial de oportunidades comerciais. O time de vendas precisa monitorar dois sistemas separados (Portal Admin + CRM) sem integração entre eles.</p>
      <p><strong>Dados disponíveis na inquiry:</strong> nome, email, telefone, empresa, mensagem, listing ou landing page de origem.</p>
    </div>

    <div class="gap-card yellow">
      <div class="gap-title"><span class="severity-yellow">MÉDIA</span> — Propostas não vinculam automaticamente ao Deal de origem</div>
      <p><strong>Problema:</strong> O schema da tabela <em>proposals</em> possui campo <em>deal_id</em> (FK opcional), mas a interface de geração de propostas não oferece opção de selecionar um Deal. A proposta é gerada selecionando empresa, ativo e investidor separadamente, sem vínculo ao deal que motivou a negociação.</p>
      <p><strong>Impacto:</strong> Não é possível ver, dentro de um deal no CRM, quais propostas foram geradas para aquela oportunidade. A rastreabilidade do pipeline fica comprometida.</p>
    </div>

    <div class="gap-card yellow">
      <div class="gap-title"><span class="severity-yellow">MÉDIA</span> — Contratos isolados do fluxo do CRM</div>
      <p><strong>Problema:</strong> Mesmo cenário das propostas. A tabela <em>contracts</em> possui <em>deal_id</em>, <em>asset_id</em> e <em>company_id</em>, mas a interface de geração não vincula ao Deal automaticamente. Contratos e propostas existem como módulos independentes, sem conexão com o pipeline de deals.</p>
      <p><strong>Impacto:</strong> Ao analisar um deal no CRM, não é possível saber se já foi gerada uma proposta ou contrato para aquela oportunidade. O fluxo Prospecção → Proposta → Contrato → Fechamento não é rastreável dentro do sistema.</p>
    </div>

    <div class="gap-card yellow">
      <div class="gap-title"><span class="severity-yellow">MÉDIA</span> — Portal Listings não possuem FK direta com Ativos</div>
      <p><strong>Problema:</strong> A tabela <em>portal_listings</em> armazena dados do ativo (título, descrição, preço, área) como campos duplicados, não como referência a um ativo existente. Se o ativo é atualizado no módulo de Ativos, o listing não reflete a mudança.</p>
      <p><strong>Impacto:</strong> Manutenção duplicada. Risco de informações desatualizadas no Portal Público. A equipe precisa atualizar os dados em dois lugares.</p>
    </div>

    <div class="gap-card green">
      <div class="gap-title"><span class="severity-green">OK</span> — Matching → CRM funciona corretamente</div>
      <p>O motor de matching gera sugestões com score. Ao aceitar um match, o sistema cria automaticamente um Deal no pipeline INVESTOR com título descritivo, labels (Matching, Score X%), e vínculo ao ativo e empresa. A integração é funcional e rastreável.</p>
    </div>

    <div class="gap-card green">
      <div class="gap-title"><span class="severity-green">OK</span> — SDR → CRM funciona corretamente</div>
      <p>Leads qualificadas podem ser promovidas a Deal com um clique. O deal herda o vínculo com a empresa de origem e é criado no pipeline correto. A integração é funcional.</p>
    </div>

    <div class="gap-card green">
      <div class="gap-title"><span class="severity-green">OK</span> — Auditoria funciona em todo o sistema</div>
      <p>Ações em deals (criar, atualizar, mover etapa, deletar), leads (mudança de status) e empresas (enriquecimento, contatos verificados) são registradas automaticamente no audit_logs com usuário, timestamp e detalhes das mudanças. O histórico é visível no painel de deals e nos relatórios.</p>
    </div>
  </div>

  <!-- 6. SUGESTÕES DE MELHORIA -->
  <div class="doc-section">
    <h2>6. Sugestões de Melhoria</h2>

    <h3>6.1 Converter Inquiries em Leads/Deals</h3>
    <p><strong>Implementação proposta:</strong></p>
    <ul>
      <li>Adicionar botão "Converter para Lead" na tela do Portal Admin, ao lado de cada inquiry</li>
      <li>Ao clicar, criar automaticamente uma empresa (se não existir pelo email/nome) e uma lead na fila SDR</li>
      <li>Alternativa: botão "Criar Deal Direto" que pula o SDR e cria deal diretamente no CRM</li>
      <li>Marcar a inquiry como "convertida" para evitar duplicação</li>
    </ul>
    <p><strong>Esforço estimado:</strong> Médio — requer nova rota backend, lógica de de-duplicação por email, e botões no frontend.</p>

    <h3>6.2 Vincular Propostas e Contratos ao Deal</h3>
    <p><strong>Implementação proposta:</strong></p>
    <ul>
      <li>Adicionar campo seletor "Deal vinculado" no diálogo de geração de propostas e contratos</li>
      <li>Ao selecionar um deal, pré-preencher empresa, ativo e investidor automaticamente a partir dos dados do deal</li>
      <li>No painel do deal (CRM), adicionar aba "Documentos" listando propostas e contratos vinculados</li>
      <li>Permitir gerar proposta/contrato diretamente a partir do painel do deal</li>
    </ul>
    <p><strong>Esforço estimado:</strong> Médio — schema já possui as FKs, falta a UI e a lógica de pré-preenchimento.</p>

    <h3>6.3 Vincular Portal Listings a Ativos existentes</h3>
    <p><strong>Implementação proposta:</strong></p>
    <ul>
      <li>Adicionar FK <em>asset_id</em> na tabela portal_listings</li>
      <li>Ao criar listing, permitir selecionar um ativo existente, preenchendo automaticamente título, descrição, preço, área</li>
      <li>Opção de sincronização: quando o ativo é atualizado, o listing reflete as mudanças</li>
    </ul>
    <p><strong>Esforço estimado:</strong> Baixo — migração simples + selector no frontend.</p>

    <h3>6.4 Pipeline visual completo (end-to-end)</h3>
    <p><strong>Implementação proposta:</strong></p>
    <ul>
      <li>Criar uma visualização de "Funil Completo" nos Relatórios mostrando o ciclo: Prospecção → Lead → Deal → Proposta → Contrato → Fechamento</li>
      <li>Para cada deal, exibir onde ele está no ciclo completo (não apenas no Kanban)</li>
      <li>Indicadores de quanto tempo cada oportunidade permanece em cada fase</li>
    </ul>
    <p><strong>Esforço estimado:</strong> Alto — requer agregação de dados de múltiplas tabelas e nova visualização.</p>

    <h3>6.5 Automação de fluxos entre módulos</h3>
    <p><strong>Implementação proposta:</strong></p>
    <ul>
      <li>Quando um deal chega à etapa "LOI", oferecer geração automática de proposta</li>
      <li>Quando um deal chega a "Fechamento", oferecer geração automática de contrato</li>
      <li>Quando um match tem score > 80%, notificar automaticamente o responsável</li>
      <li>Quando uma inquiry chega pelo Portal, criar lead automaticamente se o email ainda não existe no sistema</li>
    </ul>
    <p><strong>Esforço estimado:</strong> Médio-Alto — requer triggers no backend e configuração de regras.</p>
  </div>

  <!-- 7. DIAGRAMA DE ENTIDADES -->
  <div class="doc-section">
    <h2>7. Diagrama de Entidades e Relacionamentos</h2>
    <p>A tabela abaixo lista todas as entidades do banco de dados com suas chaves estrangeiras e relações:</p>
    <table class="doc-table">
      <thead>
        <tr><th>Entidade</th><th>Campos-chave</th><th>Referencia (FK)</th><th>Referenciada por</th></tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>organizations</strong></td>
          <td>id, name</td>
          <td>—</td>
          <td>users, companies, deals, assets, leads, audit_logs, org_settings</td>
        </tr>
        <tr>
          <td><strong>users</strong></td>
          <td>id, username, role, orgId</td>
          <td>organizations</td>
          <td>audit_logs</td>
        </tr>
        <tr>
          <td><strong>companies</strong></td>
          <td>id, legalName, cnpj, orgId</td>
          <td>organizations</td>
          <td>leads, deals, contacts, proposals, contracts, assets</td>
        </tr>
        <tr>
          <td><strong>contacts</strong></td>
          <td>id, name, companyId</td>
          <td>companies</td>
          <td>investor_profiles</td>
        </tr>
        <tr>
          <td><strong>leads</strong></td>
          <td>id, companyId, status, score</td>
          <td>companies</td>
          <td>—</td>
        </tr>
        <tr>
          <td><strong>deals</strong></td>
          <td>id, title, stageId, companyId, assetId</td>
          <td>companies, assets, pipeline_stages</td>
          <td>deal_comments, proposals, contracts</td>
        </tr>
        <tr>
          <td><strong>pipeline_stages</strong></td>
          <td>id, name, pipelineType, order</td>
          <td>organizations</td>
          <td>deals</td>
        </tr>
        <tr>
          <td><strong>assets</strong></td>
          <td>id, title, type, priceAsking, areaHa</td>
          <td>organizations, companies</td>
          <td>deals, match_suggestions, proposals, contracts</td>
        </tr>
        <tr>
          <td><strong>investor_profiles</strong></td>
          <td>id, name, ticketMin/Max, types</td>
          <td>contacts</td>
          <td>match_suggestions, proposals, contracts</td>
        </tr>
        <tr>
          <td><strong>match_suggestions</strong></td>
          <td>id, assetId, investorId, score</td>
          <td>assets, investor_profiles</td>
          <td>—</td>
        </tr>
        <tr>
          <td><strong>proposals</strong></td>
          <td>id, name, dealId, companyId, assetId</td>
          <td>deals (opcional), companies, assets, investor_profiles, proposal_templates</td>
          <td>—</td>
        </tr>
        <tr>
          <td><strong>contracts</strong></td>
          <td>id, name, dealId, companyId, assetId</td>
          <td>deals (opcional), companies, assets, contract_templates</td>
          <td>—</td>
        </tr>
        <tr>
          <td><strong>portal_listings</strong></td>
          <td>id, title, status, orgId</td>
          <td>organizations</td>
          <td>portal_inquiries</td>
        </tr>
        <tr>
          <td><strong>portal_inquiries</strong></td>
          <td>id, name, email, listingId, landingPageId</td>
          <td>portal_listings, asset_landing_pages</td>
          <td>—</td>
        </tr>
        <tr>
          <td><strong>asset_landing_pages</strong></td>
          <td>id, slug, title, status</td>
          <td>organizations, assets (opcional)</td>
          <td>portal_inquiries</td>
        </tr>
        <tr>
          <td><strong>audit_logs</strong></td>
          <td>id, entity, action, changesJson</td>
          <td>organizations, users</td>
          <td>—</td>
        </tr>
        <tr>
          <td><strong>connectors</strong></td>
          <td>id, name, type, config</td>
          <td>—</td>
          <td>raw_ingests</td>
        </tr>
        <tr>
          <td><strong>raw_ingests</strong></td>
          <td>id, connectorId, externalId, payloadJson</td>
          <td>connectors</td>
          <td>— (cache layer)</td>
        </tr>
        <tr>
          <td><strong>error_reports</strong></td>
          <td>id, title, module, status</td>
          <td>—</td>
          <td>—</td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- 8. RESUMO EXECUTIVO -->
  <div class="doc-section">
    <h2>8. Resumo Executivo</h2>
    <p>O Mavrion Connect apresenta uma arquitetura modular bem estruturada, com <strong>pontos fortes</strong> na integração Matching→CRM e SDR→CRM, sistema de auditoria abrangente, e suporte multi-pipeline no Kanban.</p>
    <p>Os <strong>principais gaps</strong> identificados estão na falta de conversão de inquiries em leads/deals (dados órfãos no Portal), no desacoplamento entre propostas/contratos e o pipeline de deals (schema pronto, UI não conectada), e na duplicação de dados entre ativos e portal listings.</p>
    <p>As melhorias sugeridas visam criar um fluxo end-to-end rastreável: <strong>Prospecção → Lead → Deal → Proposta → Contrato → Fechamento</strong>, eliminando silos de informação e reduzindo trabalho manual de re-digitação.</p>
    <p>Todas as sugestões são incrementais — podem ser implementadas uma a uma sem refatoração profunda da arquitetura existente, pois as FKs necessárias já existem no schema na maioria dos casos.</p>
  </div>

</div>
`;
}

async function exportPdf() {
  const { default: jsPDF } = await import("jspdf");
  const { default: html2canvas } = await import("html2canvas");

  const container = document.createElement("div");
  container.style.cssText = "position:fixed;top:-9999px;left:-9999px;z-index:-1;";

  const wrapper = document.createElement("div");
  wrapper.innerHTML = buildDocHtml();
  container.appendChild(wrapper);
  document.body.appendChild(container);

  const docPage = wrapper.querySelector(".doc-page") as HTMLElement;
  if (!docPage) { document.body.removeChild(container); return; }

  try {
    const canvas = await html2canvas(docPage, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pdfW = pdf.internal.pageSize.getWidth();
    const pdfH = pdf.internal.pageSize.getHeight();
    const pageHeightPx = (pdfH / pdfW) * canvas.width;
    let yPos = 0;
    let pageNum = 0;

    while (yPos < canvas.height) {
      const sliceH = Math.min(pageHeightPx, canvas.height - yPos);
      const sliceCanvas = document.createElement("canvas");
      sliceCanvas.width = canvas.width;
      sliceCanvas.height = sliceH;
      const ctx = sliceCanvas.getContext("2d")!;
      ctx.drawImage(canvas, 0, yPos, sliceCanvas.width, sliceH, 0, 0, sliceCanvas.width, sliceH);
      if (pageNum > 0) pdf.addPage();
      const sliceHeightMm = (sliceH / sliceCanvas.width) * pdfW;
      pdf.addImage(sliceCanvas.toDataURL("image/png"), "PNG", 0, 0, pdfW, sliceHeightMm);

      pdf.setFontSize(7.5);
      pdf.setTextColor(160, 160, 160);
      pdf.setDrawColor(220, 220, 220);
      pdf.line(15, pdfH - 12, pdfW - 15, pdfH - 12);
      pdf.text("Mavrion Connect — Documento de Arquitetura", 15, pdfH - 7);
      pdf.text(`Página ${pageNum + 1}`, pdfW / 2, pdfH - 7, { align: "center" });
      pdf.text(today, pdfW - 15, pdfH - 7, { align: "right" });

      yPos += pageHeightPx;
      pageNum++;
    }

    pdf.save("Mavrion_Conect_Arquitetura.pdf");
  } finally {
    document.body.removeChild(container);
  }
}

export default function ArquiteturaPage() {
  const { toast } = useToast();
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportPdf();
      toast({ title: "PDF gerado com sucesso", description: "O download deve iniciar automaticamente." });
    } catch (err) {
      toast({ title: "Erro ao gerar PDF", description: String(err), variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-arquitetura-title">Documento de Arquitetura</h1>
          <p className="text-sm text-muted-foreground">Mapa completo de conexões entre módulos do Mavrion Connect</p>
        </div>
        <Button onClick={handleExport} disabled={exporting} data-testid="btn-export-pdf">
          {exporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
          {exporting ? "Gerando PDF..." : "Exportar PDF"}
        </Button>
      </div>

      <div className="bg-white rounded-xl border shadow-sm overflow-auto">
        <div
          className="mx-auto"
          style={{ maxWidth: 794 }}
          dangerouslySetInnerHTML={{ __html: buildDocHtml() }}
        />
      </div>
    </div>
  );
}

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function IaGuiaPdf() {
  const [generating, setGenerating] = useState(false);
  const { toast } = useToast();

  const generatePdf = async () => {
    setGenerating(true);
    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const W = 210;
      const H = 297;
      const M = 25;
      const CW = W - 2 * M;
      let y = 0;

      const emerald = [16, 185, 129] as [number, number, number];
      const darkGreen = [6, 78, 59] as [number, number, number];
      const navy = [15, 23, 42] as [number, number, number];
      const gray = [100, 116, 139] as [number, number, number];
      const white = [255, 255, 255] as [number, number, number];
      const lightBg = [248, 250, 252] as [number, number, number];
      const violet = [124, 58, 237] as [number, number, number];

      const addPage = () => { doc.addPage(); y = M; };

      const title = (text: string, color = navy, size = 18) => {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(size);
        doc.setTextColor(...color);
        doc.text(text, M, y);
        y += size * 0.5 + 2;
      };

      const subtitle = (text: string) => {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(13);
        doc.setTextColor(...emerald);
        doc.text(text, M, y);
        y += 8;
      };

      const body = (text: string, indent = 0) => {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(...navy);
        const lines = doc.splitTextToSize(text, CW - indent);
        doc.text(lines, M + indent, y);
        y += lines.length * 5 + 2;
      };

      const bullet = (text: string) => {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(...navy);
        doc.text("•", M + 4, y);
        const lines = doc.splitTextToSize(text, CW - 12);
        doc.text(lines, M + 10, y);
        y += lines.length * 5 + 1;
      };

      const divider = () => {
        doc.setDrawColor(...emerald);
        doc.setLineWidth(0.5);
        doc.line(M, y, W - M, y);
        y += 6;
      };

      const spacer = (h = 4) => { y += h; };

      const checkPage = (needed = 40) => {
        if (y + needed > H - 20) addPage();
      };

      const footer = (page: number) => {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(...gray);
        doc.text("Mavrion Connect — Documento Confidencial", M, H - 10);
        doc.text(`Página ${page}`, W - M, H - 10, { align: "right" });
      };

      // ═══════════ CAPA ═══════════
      doc.setFillColor(...darkGreen);
      doc.rect(0, 0, W, H, "F");

      doc.setFillColor(...emerald);
      doc.rect(0, 80, W, 4, "F");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(36);
      doc.setTextColor(...white);
      doc.text("MAVRION CONNECT", W / 2, 110, { align: "center" });

      doc.setFontSize(16);
      doc.setTextColor(167, 243, 208);
      doc.text("Agentes de Inteligência Artificial", W / 2, 125, { align: "center" });

      doc.setFillColor(...emerald);
      doc.rect(60, 135, 90, 0.8, "F");

      doc.setFont("helvetica", "normal");
      doc.setFontSize(12);
      doc.setTextColor(...white);
      doc.text("Guia de Uso e Possibilidades", W / 2, 150, { align: "center" });

      doc.setFontSize(10);
      doc.setTextColor(167, 243, 208);
      const today = new Date().toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
      doc.text(today.charAt(0).toUpperCase() + today.slice(1), W / 2, 165, { align: "center" });

      doc.setFontSize(9);
      doc.setTextColor(167, 243, 208);
      doc.text("Confidencial — Uso Interno", W / 2, H - 25, { align: "center" });

      footer(1);

      // ═══════════ PÁGINA 2 — ÍNDICE ═══════════
      addPage();
      y = 35;
      title("Índice", darkGreen, 22);
      spacer(6);
      divider();
      spacer(4);

      const idx = [
        ["1.", "Visão Geral dos Agentes IA"],
        ["2.", "Agente 1 — Análise Inteligente do Ativo"],
        ["3.", "Agente 2 — Resumo 360° da Empresa"],
        ["4.", "Agente 3 — Busca por Linguagem Natural"],
        ["5.", "Agente 4 — Relatório Ativo + Comprador"],
        ["6.", "Agente 5 — Diagnóstico de Erros"],
        ["7.", "Tecnologia e Segurança"],
        ["8.", "Possibilidades Futuras"],
      ];
      for (const [num, label] of idx) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.setTextColor(...emerald);
        doc.text(num, M + 5, y);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(...navy);
        doc.text(label, M + 15, y);
        y += 9;
      }

      footer(2);

      // ═══════════ PÁGINA 3 — VISÃO GERAL ═══════════
      addPage();
      y = 35;
      title("1. Visão Geral dos Agentes IA", darkGreen, 16);
      spacer(4);
      divider();
      spacer(2);

      body("A Mavrion Connect integra 5 agentes de inteligência artificial alimentados pelo modelo GPT-4o-mini da OpenAI. Cada agente foi desenhado para acelerar uma etapa específica do fluxo de originação de deals, reduzindo trabalho manual e oferecendo insights que seriam impossíveis de obter rapidamente por métodos tradicionais.");
      spacer(4);

      body("Os agentes trabalham diretamente sobre os dados já existentes na plataforma — ativos, empresas, histórico de deals, perfis de compradores — sem necessidade de input externo. Basta clicar um botão.");
      spacer(6);

      doc.setFillColor(...lightBg);
      doc.roundedRect(M, y, CW, 50, 3, 3, "F");
      doc.setDrawColor(200, 210, 220);
      doc.roundedRect(M, y, CW, 50, 3, 3, "S");
      y += 8;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(...violet);
      doc.text("Resumo dos 5 Agentes", M + 6, y);
      y += 7;
      const agentSummary = [
        "Análise do Ativo — Score e diagnóstico em 5 dimensões",
        "Resumo da Empresa — Perfil 360° do potencial comprador",
        "Busca Natural — Pesquise ativos usando linguagem comum",
        "Relatório Ativo+Comprador — Documento personalizado de venda",
        "Diagnóstico de Erros — Explica problemas técnicos em português simples",
      ];
      for (const item of agentSummary) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9.5);
        doc.setTextColor(...navy);
        doc.text("▸  " + item, M + 6, y);
        y += 6.5;
      }
      y += 6;

      footer(3);

      // ═══════════ PÁGINA 4 — AGENTE 1 ═══════════
      addPage();
      y = 35;
      title("2. Análise Inteligente do Ativo", darkGreen, 16);
      spacer(2);
      divider();
      spacer(2);

      subtitle("O que faz");
      body("Analisa qualquer ativo da plataforma em 5 dimensões independentes, gerando um score de 0 a 100 e uma recomendação clara de ação.");
      spacer(3);

      subtitle("As 5 Dimensões");
      bullet("Potencial Produtivo — avalia área, preço por hectare, campos específicos do tipo de ativo");
      bullet("Contexto Regional — analisa a localização, município, estado e potencial da região");
      bullet("Risco Ambiental — verifica indicadores ambientais, documentação e status regulatório");
      bullet("Risco Financeiro — analisa preço pedido, condições de mercado e viabilidade");
      bullet("Compatibilidade com Compradores — cruza com perfis de compradores cadastrados na plataforma");
      spacer(4);

      subtitle("Como acessar");
      body("1. Abra qualquer ativo no sistema");
      body("2. Clique na aba 'IA' (última aba da página de detalhe)");
      body("3. Clique em 'Analisar com IA'");
      body("4. Em segundos, o resultado aparece com score, análise por dimensão e recomendação");
      spacer(4);

      subtitle("Valor para o negócio");
      bullet("Priorização rápida: identifique os melhores ativos do portfólio em minutos");
      bullet("Due diligence preliminar: tenha uma visão 360° antes de investir tempo em análise manual");
      bullet("Padronização: todos os ativos são avaliados com os mesmos critérios objetivos");

      footer(4);

      // ═══════════ PÁGINA 5 — AGENTE 2 ═══════════
      addPage();
      y = 35;
      title("3. Resumo 360° da Empresa", darkGreen, 16);
      spacer(2);
      divider();
      spacer(2);

      subtitle("O que faz");
      body("Gera um perfil executivo completo de qualquer empresa cadastrada, cruzando dados de CNPJ, histórico de deals, perfil de comprador e atividade na plataforma.");
      spacer(3);

      subtitle("Informações geradas");
      bullet("Identificação completa: razão social, CNPJ, porte, CNAE principal");
      bullet("Análise setorial: em que segmentos a empresa atua e como se posiciona");
      bullet("Histórico na plataforma: deals anteriores, interações, padrões de compra");
      bullet("Perfil de comprador: tipos de ativos preferidos, faixa de ticket, regiões de interesse");
      bullet("Pontos de atenção: riscos ou oportunidades identificados pela IA");
      spacer(4);

      subtitle("Como acessar");
      body("1. Abra qualquer empresa no módulo Empresas");
      body("2. No topo da página, clique no botão 'Resumo IA' (ícone roxo de cérebro)");
      body("3. Um painel abre com o resumo completo da empresa");
      spacer(4);

      subtitle("Valor para o negócio");
      bullet("Preparação para reuniões: entenda o comprador em 30 segundos antes de ligar");
      bullet("Qualificação de leads: identifique rapidamente se a empresa tem fit com seus ativos");
      bullet("Inteligência competitiva: entenda padrões de comportamento de compradores");

      footer(5);

      // ═══════════ PÁGINA 6 — AGENTE 3 ═══════════
      addPage();
      y = 35;
      title("4. Busca por Linguagem Natural", darkGreen, 16);
      spacer(2);
      divider();
      spacer(2);

      subtitle("O que faz");
      body("Permite pesquisar ativos usando linguagem comum em português. A IA interpreta a frase, converte em filtros técnicos e retorna os resultados mais relevantes com insights.");
      spacer(3);

      subtitle("Exemplos de buscas");
      doc.setFillColor(...lightBg);
      doc.roundedRect(M, y, CW, 42, 3, 3, "F");
      y += 7;
      const examples = [
        '"Fazendas acima de 500 hectares em Mato Grosso do Sul"',
        '"Minas de ouro com licença ativa no Pará"',
        '"Ativos baratos abaixo de R$ 2 milhões em Goiás"',
        '"Terrenos próximos a São Paulo com boa documentação"',
        '"Negócios do setor agro com faturamento alto"',
      ];
      for (const ex of examples) {
        doc.setFont("helvetica", "italic");
        doc.setFontSize(9.5);
        doc.setTextColor(...navy);
        doc.text("→  " + ex, M + 6, y);
        y += 6.5;
      }
      y += 6;

      subtitle("Como funciona internamente");
      body("A IA recebe a frase, identifica os critérios (tipo, região, área, preço, status), converte em filtros de banco de dados, executa a busca e retorna os ativos encontrados junto com uma análise inteligente dos resultados.");
      spacer(4);

      subtitle("Status atual");
      body("Este agente está funcional via API (/api/ai/search). A interface visual com barra de busca na página de prospecção pode ser adicionada como próximo passo.");
      spacer(4);

      subtitle("Valor para o negócio");
      bullet("Acessibilidade: qualquer pessoa encontra ativos sem conhecer os filtros técnicos");
      bullet("Velocidade: uma frase substitui 5-6 campos de filtro");
      bullet("Insights automáticos: além dos resultados, a IA comenta sobre o que encontrou");

      footer(6);

      // ═══════════ PÁGINA 7 — AGENTE 4 ═══════════
      addPage();
      y = 35;
      title("5. Relatório Ativo + Comprador", darkGreen, 16);
      spacer(2);
      divider();
      spacer(2);

      subtitle("O que faz");
      body("Gera um documento de venda personalizado mostrando por que determinado ativo é ideal para determinado comprador. Cruza as características do ativo com o perfil e histórico da empresa.");
      spacer(3);

      subtitle("Conteúdo do relatório");
      bullet("Resumo executivo: por que esta combinação faz sentido");
      bullet("Análise de fit: como o ativo atende aos critérios do comprador");
      bullet("Dados financeiros: preço, condições e projeção de retorno");
      bullet("Contexto regional: vantagens da localização para o perfil do comprador");
      bullet("Recomendação: próximos passos sugeridos para avançar a negociação");
      spacer(4);

      subtitle("Como acessar");
      body("1. Abra um ativo e vá para a aba 'IA'");
      body("2. Na seção 'Relatório Personalizado', digite o ID da empresa compradora");
      body("3. Clique no botão de gerar");
      body("4. O relatório aparece formatado, pronto para copiar ou apresentar");
      spacer(4);

      subtitle("Valor para o negócio");
      bullet("Personalização em escala: gere documentos de venda únicos para cada comprador");
      bullet("Produtividade: elimina horas de preparação manual de apresentações");
      bullet("Argumentação: a IA identifica ângulos de venda que você pode não ter considerado");

      footer(7);

      // ═══════════ PÁGINA 8 — AGENTE 5 ═══════════
      addPage();
      y = 35;
      title("6. Diagnóstico de Erros", darkGreen, 16);
      spacer(2);
      divider();
      spacer(2);

      subtitle("O que faz");
      body("Analisa erros técnicos reportados pelo sistema e os explica em linguagem simples, com causa provável e sugestão de solução. Ideal para que a equipe não-técnica entenda problemas sem depender do time de desenvolvimento.");
      spacer(3);

      subtitle("Como acessar");
      body("1. Vá para Configurações > Relatórios de Erro");
      body("2. Clique no ícone de olho para abrir o detalhe de um erro");
      body("3. Clique em 'Diagnosticar com IA'");
      body("4. A IA explica o que aconteceu, a causa provável e como resolver");
      spacer(4);

      subtitle("Valor para o negócio");
      bullet("Autonomia: a equipe entende e resolve problemas simples sem escalar para TI");
      bullet("Velocidade: diagnóstico instantâneo vs. horas esperando suporte técnico");
      bullet("Documentação: cada diagnóstico fica registrado para referência futura");

      footer(8);

      // ═══════════ PÁGINA 9 — TECNOLOGIA E SEGURANÇA ═══════════
      addPage();
      y = 35;
      title("7. Tecnologia e Segurança", darkGreen, 16);
      spacer(2);
      divider();
      spacer(2);

      subtitle("Modelo utilizado");
      body("Todos os agentes utilizam o GPT-4o-mini da OpenAI, um modelo otimizado para velocidade e custo-benefício, com excelente capacidade de análise em português.");
      spacer(3);

      subtitle("Segurança dos dados");
      bullet("Todos os endpoints requerem autenticação — apenas usuários logados podem usar os agentes");
      bullet("Rate limiting de 5 segundos entre chamadas para evitar uso abusivo");
      bullet("Os dados enviados à OpenAI são apenas os campos relevantes do ativo/empresa (nunca o banco inteiro)");
      bullet("A OpenAI não utiliza dados de API para treinar seus modelos (política de uso empresarial)");
      bullet("Isolamento multi-tenant: cada organização só acessa seus próprios dados");
      spacer(4);

      subtitle("Custos");
      body("O GPT-4o-mini tem custo muito baixo: aproximadamente US$ 0,15 por 1 milhão de tokens de input e US$ 0,60 por 1 milhão de tokens de output. Na prática, cada análise custa frações de centavo.");
      spacer(3);

      doc.setFillColor(...lightBg);
      doc.roundedRect(M, y, CW, 28, 3, 3, "F");
      y += 7;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(...emerald);
      doc.text("Estimativa de custo mensal", M + 6, y);
      y += 6;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(...navy);
      doc.text("Com uso intensivo (100 análises/dia): ~ US$ 1-3 por mês", M + 6, y);
      y += 6;
      doc.text("Uso moderado (20 análises/dia): ~ US$ 0,20-0,60 por mês", M + 6, y);
      y += 10;

      footer(9);

      // ═══════════ PÁGINA 10 — POSSIBILIDADES FUTURAS ═══════════
      addPage();
      y = 35;
      title("8. Possibilidades Futuras", darkGreen, 16);
      spacer(2);
      divider();
      spacer(2);

      body("Os agentes atuais são o primeiro passo. A arquitetura permite expansão significativa:");
      spacer(4);

      subtitle("Curto prazo (1-2 meses)");
      bullet("Barra de busca inteligente na interface — digitar em linguagem natural direto na prospecção");
      bullet("Auto-matching: a IA sugere automaticamente os 5 melhores compradores para cada novo ativo");
      bullet("Resumo automático de deals: ao criar um deal, a IA gera um briefing para o time");
      spacer(4);

      subtitle("Médio prazo (3-6 meses)");
      bullet("Agente de e-mail: a IA redige e-mails personalizados de prospecção para cada lead");
      bullet("Agente de precificação: sugere preço justo baseado em comparáveis e dados regionais");
      bullet("Dashboard de insights: resumo diário gerado pela IA com tendências e oportunidades");
      bullet("Alertas inteligentes: notificações quando um novo ativo combina com compradores existentes");
      spacer(4);

      subtitle("Longo prazo (6-12 meses)");
      bullet("Agente autônomo de prospecção: busca e qualifica compradores automaticamente");
      bullet("Análise preditiva: previsão de fechamento de deals baseada em padrões históricos");
      bullet("Integração com dados externos: IBGE, cotações agrícolas, dados climáticos em tempo real");
      bullet("Chatbot interno: assistente conversacional para a equipe tirar dúvidas sobre qualquer dado");
      spacer(8);

      doc.setFillColor(...darkGreen);
      doc.roundedRect(M, y, CW, 30, 3, 3, "F");
      y += 10;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.setTextColor(...white);
      doc.text("A inteligência artificial não substitui a equipe.", W / 2, y, { align: "center" });
      y += 7;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(167, 243, 208);
      doc.text("Ela amplifica a capacidade de cada pessoa no time.", W / 2, y, { align: "center" });

      footer(10);

      doc.save("Mavrion_Connect_Agentes_IA.pdf");
      toast({ title: "PDF gerado!", description: "O download deve iniciar automaticamente." });
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    }
    setGenerating(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-8 bg-gradient-to-br from-emerald-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      <div className="max-w-lg text-center space-y-6">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-emerald-600 flex items-center justify-center">
          <Download className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white" data-testid="title-ia-guia">
          Guia dos Agentes IA — Mavrion Connect
        </h1>
        <p className="text-muted-foreground">
          Documento PDF de 10 páginas com explicação de cada agente, como usar, valor para o negócio e possibilidades futuras. Pronto para enviar aos sócios.
        </p>
        <Button
          size="lg"
          onClick={generatePdf}
          disabled={generating}
          className="gap-2 bg-emerald-600 hover:bg-emerald-700"
          data-testid="button-gerar-pdf"
        >
          {generating ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
          {generating ? "Gerando PDF..." : "Baixar PDF (10 páginas)"}
        </Button>
      </div>
    </div>
  );
}

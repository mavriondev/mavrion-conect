import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  LayoutDashboard, Magnet, Telescope, Building2, KanbanSquare, Target,
  FileText, FileSignature, Layers, Map, TreePine, BarChart2, Plug, Users, Settings2,
  Search, ChevronDown, ChevronRight, ArrowRight, Zap, BookOpen, Globe, Activity, Bug,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Section {
  id: string;
  icon: any;
  title: string;
  badge?: string;
  badgeColor?: string;
  summary: string;
  subsections: {
    title: string;
    content: string;
  }[];
  flow?: string;
}

const MANUAL_SECTIONS: Section[] = [
  {
    id: "dashboard",
    icon: LayoutDashboard,
    title: "Dashboard",
    badge: "Visao Geral",
    badgeColor: "bg-blue-500/10 text-blue-600 border-blue-200",
    summary: "Painel principal com indicadores-chave de desempenho (KPIs) do negocio, graficos de evolucao e atividade recente.",
    subsections: [
      {
        title: "O que voce encontra aqui",
        content: "Ao abrir o sistema, o Dashboard mostra um resumo executivo: total de leads ativas, deals em andamento, ativos cadastrados e valor total do portfolio. Os cards superiores mostram numeros em tempo real — tudo o que esta acontecendo no seu funil de negocios."
      },
      {
        title: "Graficos e tendencias",
        content: "O grafico de area mostra a evolucao semanal de leads e deals, permitindo visualizar se a operacao esta crescendo. Abaixo, a lista de deals recentes mostra os negocios com maior movimentacao, com nome da empresa, valor e estagio atual."
      },
      {
        title: "Como usar",
        content: "Use o Dashboard como ponto de partida diario. Verifique se ha leads novas para qualificar, deals parados que precisam de atencao, e se o pipeline esta saudavel. Nao e necessario nenhuma acao — os dados sao atualizados automaticamente."
      }
    ]
  },
  {
    id: "sdr",
    icon: Magnet,
    title: "SDR Queue",
    badge: "Qualificacao",
    badgeColor: "bg-amber-500/10 text-amber-600 border-amber-200",
    summary: "Fila de trabalho do SDR (Sales Development Representative). Aqui voce gerencia leads, qualifica empresas e promove as melhores para o pipeline de deals.",
    subsections: [
      {
        title: "O que e a SDR Queue",
        content: "A SDR Queue e sua mesa de trabalho principal. Ela mostra todas as empresas que foram importadas como leads e que precisam ser qualificadas. Cada lead aparece como um card com o nome da empresa, CNPJ, porte, setor e um score de prioridade."
      },
      {
        title: "Qualificacao de leads",
        content: "Para qualificar uma lead, voce deve: (1) clicar na empresa para ver os detalhes, (2) verificar os dados de contato, (3) pesquisar informacoes adicionais na aba Pesquisa, (4) preencher os Dados Verificados com telefone, email e nome do contato real. O badge verde 'Dados Verificados' aparece quando a lead tem informacoes de contato confirmadas pelo SDR."
      },
      {
        title: "Dados Verificados vs Receita Federal",
        content: "Os dados que vem automaticamente da Receita Federal (telefone, email) sao frequentemente desatualizados — muitas vezes sao do contador ou de um telefone antigo. A secao 'Dados Verificados' permite que voce salve o telefone real, o WhatsApp, o email correto e o nome do decisor. Esses dados tem prioridade sobre os da Receita em todo o sistema."
      },
      {
        title: "Promover para Deal",
        content: "Quando uma lead esta qualificada e pronta para negociar, clique em 'Promover a Deal'. O dialogo mostra os dados verificados (se existirem) ja pre-preenchidos. Voce escolhe o pipeline (Investidor ou Dono de Ativo) e o deal e criado automaticamente no CRM Kanban."
      },
      {
        title: "Badges de status",
        content: "Badge verde 'Dados Verificados': a empresa tem contato confirmado pelo SDR. Badge amarelo 'Nao verificado': so tem dados da Receita Federal. Quanto mais leads com badge verde, melhor a qualidade do seu pipeline."
      }
    ],
    flow: "Prospecção → Importar Lead → SDR Queue → Qualificar → Dados Verificados → Promover a Deal → CRM"
  },
  {
    id: "prospeccao",
    icon: Telescope,
    title: "Prospeccao",
    badge: "Busca B2B",
    badgeColor: "bg-indigo-500/10 text-indigo-600 border-indigo-200",
    summary: "Motor de busca avancado para encontrar empresas por CNPJ, CNAE, porte, localizacao e situacao cadastral. Usa dados publicos da Receita Federal.",
    subsections: [
      {
        title: "Como buscar empresas",
        content: "Ha duas formas: (1) Busca por CNPJ — digite o CNPJ completo e o sistema busca os dados na Receita Federal via API CNPJA, trazendo razao social, endereco, socios, atividades e contato. (2) Busca avancada — use os filtros de CNAE (arvore hierarquica), UF, municipio, porte, situacao cadastral e natureza juridica para encontrar empresas por segmento."
      },
      {
        title: "Filtros avancados",
        content: "O seletor de CNAE usa uma arvore hierarquica: Secao > Divisao > Grupo > Classe. Exemplo: para buscar mineradoras, selecione 'B - Industrias Extrativas' > '07 - Extracao de minerais metalicos'. Combine com UF e porte para refinar. O filtro de situacao permite ver apenas empresas ativas."
      },
      {
        title: "Importar para o sistema",
        content: "Ao encontrar uma empresa interessante, clique em 'Importar' ou 'Criar Lead'. A empresa e salva no banco de dados e aparece na SDR Queue para qualificacao. Se a empresa ja existir, o sistema avisa."
      }
    ],
    flow: "Filtros → Buscar → Resultado → Importar → SDR Queue"
  },
  {
    id: "empresas",
    icon: Building2,
    title: "Empresas",
    badge: "Base de Dados",
    badgeColor: "bg-slate-500/10 text-slate-600 border-slate-200",
    summary: "Base centralizada de todas as empresas importadas. Permite visualizar, filtrar e acessar detalhes completos de cada empresa.",
    subsections: [
      {
        title: "Visoes disponiveis",
        content: "O menu Empresas tem tres sub-paginas: 'Todas as Empresas' (base completa), 'Leads Ativas' (empresas marcadas como lead em qualificacao) e 'Desqualificadas' (leads que foram descartadas). Use os filtros laterais de porte, estado e cidade para encontrar rapidamente."
      },
      {
        title: "Detalhe da empresa",
        content: "Ao clicar em uma empresa, voce acessa o detalhe com varias abas: Resumo (dados cadastrais, socios, endereco), Contato (telefones, emails, com indicacao de fonte — Receita Federal, Enrichment Web ou Verificado), Pesquisa (notas de pesquisa e dados verificados), Deals (historico de negocios), Timeline (eventos registrados)."
      },
      {
        title: "Dados Verificados na empresa",
        content: "Na aba de detalhe, a secao 'Dados Verificados' (com borda verde) permite salvar: telefone principal, email, WhatsApp, nome do contato, cargo e observacoes. Esses dados ficam salvos e sao usados em todo o sistema — no SDR, na promocao a deal, no CRM e nas propostas."
      },
      {
        title: "Enrichment Web",
        content: "O botao 'Enriquecer' busca informacoes adicionais na web (telefones, emails, redes sociais) usando um scraper automatico. Os dados encontrados sao marcados como 'Enrichment Web' para diferencia-los dos dados da Receita Federal."
      }
    ]
  },
  {
    id: "crm",
    icon: KanbanSquare,
    title: "CRM Kanban",
    badge: "Pipeline",
    badgeColor: "bg-green-500/10 text-green-600 border-green-200",
    summary: "Painel Kanban visual para gerenciar deals em diferentes estagios. Dois pipelines: Investidor e Dono de Ativo.",
    subsections: [
      {
        title: "Dois pipelines",
        content: "O CRM tem dois pipelines separados: (1) Pipeline Investidor — para deals com fundos e investidores que buscam adquirir ativos. (2) Pipeline Dono de Ativo — para deals com proprietarios que querem vender. As abas no topo alternam entre eles."
      },
      {
        title: "Estagios do Kanban",
        content: "Cada pipeline tem colunas representando estagios do negocio (ex: Novo, Contato Inicial, Due Diligence, Proposta, Negociacao, Fechamento). Arraste os cards entre colunas conforme o deal avanca. O sistema registra a movimentacao automaticamente."
      },
      {
        title: "Slide-over de detalhe",
        content: "Ao clicar em um deal, abre um painel lateral com todos os detalhes: valor, empresa associada, notas, historico. Se a empresa tem Dados Verificados, eles aparecem em destaque com borda verde, facilitando o contato direto com o decisor."
      },
      {
        title: "Criar deal manualmente",
        content: "Alem de promover leads pelo SDR, voce pode criar deals diretamente no CRM clicando em 'Novo Deal'. Preencha empresa, titulo, valor e pipeline."
      }
    ],
    flow: "SDR (Promover) → Deal criado → Kanban → Arrastar entre estágios → Fechamento"
  },
  {
    id: "matching",
    icon: Target,
    title: "Deal Matching",
    badge: "Motor de Sugestao",
    badgeColor: "bg-purple-500/10 text-purple-600 border-purple-200",
    summary: "Motor inteligente que cruza automaticamente ativos disponiveis com perfis de investidores, gerando sugestoes de negocio com score de compatibilidade.",
    subsections: [
      {
        title: "Como funciona o Matching",
        content: "O Matching e como um 'casamento' automatico entre ativos e investidores. Voce cadastra os ativos (fazendas, minas, negocios) com tipo, preco e localizacao. Depois cadastra perfis de investidores com suas preferencias (que tipos de ativo buscam, ticket minimo/maximo, regioes de interesse). O motor cruza tudo e gera sugestoes."
      },
      {
        title: "Score de compatibilidade",
        content: "Cada sugestao recebe um score de 0 a 100%, calculado assim: Tipo de ativo compativel (+40 pontos) — o tipo do ativo bate com as preferencias do investidor. Preco dentro do ticket (+40 pontos) — o preco pedido esta entre o ticket minimo e maximo do investidor. Regiao de interesse (+20 pontos) — a localizacao do ativo esta em uma regiao que o investidor busca. Score verde (80%+): match excelente. Amarelo (50-79%): match parcial. Vermelho (abaixo de 50%): match fraco."
      },
      {
        title: "As tres abas",
        content: "Sugestoes — mostra os matches gerados, com cards contendo o ativo, o investidor, o score e a analise detalhada. Voce pode aceitar ou rejeitar cada sugestao. Ativos — lista todos os ativos cadastrados no motor de matching. Voce pode adicionar novos ativos aqui. Investidores — lista todos os perfis de investidor cadastrados, com seus tipos de ativo, ticket e regioes."
      },
      {
        title: "Executar Matching",
        content: "Clique no botao 'Executar Matching' para rodar o motor. Ele varre todos os ativos e investidores, calcula os scores e gera novas sugestoes. Matches que ja existem nao sao duplicados. Use o filtro de score minimo para ver apenas os melhores resultados."
      },
      {
        title: "Exemplo pratico",
        content: "Voce cadastra o ativo 'Fazenda 1000ha em Goias — R$ 5M'. Cadastra o investidor 'Fundo Capital Verde' que busca TERRA e AGRO, ticket de R$ 3M a R$ 10M, regioes Centro-Oeste. Ao executar o matching, o sistema gera uma sugestao com score 100% (tipo bate, preco esta no range, regiao bate). Voce aceita e cria um deal no CRM para essa oportunidade."
      },
      {
        title: "Aceitar vs Rejeitar",
        content: "Aceitar um match sinaliza que voce vai prosseguir com a oportunidade — ideal criar um deal no CRM a partir dele. Rejeitar remove o match da lista ativa. Isso ajuda a manter o pipeline limpo e focado nas melhores oportunidades."
      }
    ],
    flow: "Cadastrar Ativos → Cadastrar Investidores → Executar Matching → Sugestões com Score → Aceitar → Criar Deal no CRM"
  },
  {
    id: "propostas",
    icon: FileText,
    title: "Propostas",
    badge: "Documentos",
    badgeColor: "bg-orange-500/10 text-orange-600 border-orange-200",
    summary: "Gerador de propostas comerciais com templates editaveis, expressoes dinamicas que puxam dados do CRM, e exportacao para PDF.",
    subsections: [
      {
        title: "Templates com editor rico",
        content: "Na aba 'Templates', voce cria modelos de proposta usando o editor Tiptap (similar ao Google Docs). Formatacao completa: titulos, negrito, italico, listas, alinhamento, fontes e cores. Cada template tem um tipo: INVESTIDOR ou DONO DE ATIVO."
      },
      {
        title: "Expressoes dinamicas",
        content: "O grande diferencial e o uso de expressoes como {{empresa.razao_social}}, {{ativo.preco}}, {{data.hoje}}. Na hora de gerar a proposta, essas expressoes sao substituidas automaticamente pelos dados reais. Grupos disponiveis: Empresa (nome, CNPJ, cidade, estado, telefone, email), Ativo (titulo, tipo, preco, area, localizacao, matricula), Investidor (nome, ticket, regioes), Minha Empresa (nome, logo), Data (hoje por extenso, mes/ano)."
      },
      {
        title: "Gerar proposta",
        content: "Na aba 'Propostas Geradas', clique em 'Gerar Proposta'. Selecione o template, a empresa e o ativo. O sistema substitui todas as expressoes e cria um documento final pronto para enviar. Voce pode visualizar o resultado e exportar para PDF."
      },
      {
        title: "Exportar PDF",
        content: "O botao PDF gera um arquivo PDF profissional a partir da proposta renderizada. O PDF mantem a formatacao, fontes e layout do editor. Ideal para enviar por email ou imprimir."
      }
    ],
    flow: "Criar Template → Inserir Expressões → Gerar Proposta (empresa + ativo) → Revisar → Exportar PDF"
  },
  {
    id: "ativos",
    icon: Layers,
    title: "Ativos",
    badge: "Portfolio",
    badgeColor: "bg-emerald-500/10 text-emerald-600 border-emerald-200",
    summary: "Inventario completo de ativos em oferta: fazendas, minas, negocios M&A, FIIs, agronegocio e energia renovavel.",
    subsections: [
      {
        title: "Tipos de ativo",
        content: "O sistema suporta 7 categorias: Terras & Fazendas (TERRA), Mineracao (MINA), Negocios M&A (NEGOCIO), FII/CRI/Imoveis (FII_CRI), Desenvolvimento Imobiliario (DESENVOLVIMENTO), Agronegocio (AGRO) e Energia Renovavel (ENERGIA). Cada tipo tem seu icone e cor no sidebar."
      },
      {
        title: "Filtros por tipo",
        content: "No sidebar, o submenu Ativos permite filtrar por tipo diretamente: clicar em 'Terras & Fazendas' mostra apenas ativos do tipo TERRA, clicar em 'Mineracao' mostra MINA, etc. 'Todos os Ativos' mostra o inventario completo."
      },
      {
        title: "Cadastrar ativo",
        content: "Para cadastrar, clique em 'Novo Ativo'. Preencha: titulo, tipo, localizacao (estado/cidade), preco pedido, area em hectares, matricula do imovel e observacoes. Ativos podem ser vinculados a processos ANM ou propriedades CAR."
      },
      {
        title: "Detalhe do ativo",
        content: "Ao clicar em um ativo, voce ve o detalhe completo com todas as informacoes, mapa de localizacao (quando disponivel), historico de modificacoes e deals associados."
      }
    ]
  },
  {
    id: "anm",
    icon: Map,
    title: "Portal ANM",
    badge: "Geoespacial",
    badgeColor: "bg-cyan-500/10 text-cyan-600 border-cyan-200",
    summary: "Integracao com a Agencia Nacional de Mineracao (ANM). Busca processos minerarios, visualiza poligonos no mapa e identifica oportunidades.",
    subsections: [
      {
        title: "O que e o Portal ANM",
        content: "A ANM (Agencia Nacional de Mineracao) e o orgao do governo que gerencia todos os processos minerarios do Brasil. Nosso modulo consulta diretamente os dados publicos da ANM e plota os poligonos das areas minerarias no mapa, similar ao SIGMINE."
      },
      {
        title: "Filtros de busca",
        content: "Use os filtros no painel lateral para refinar: UF (estado), Substancia (ouro, ferro, calcario, areia, etc.), Fase do processo (Requerimento, Autorizacao, Concessao, Disponibilidade, etc.) e ano. A fase 'Disponibilidade' e especialmente interessante pois indica areas que podem ser requeridas."
      },
      {
        title: "Mapa interativo",
        content: "Os resultados aparecem como poligonos coloridos no mapa Leaflet. Ao clicar em um poligono, um popup mostra os detalhes: Titular, Fase (badge azul), Substancia, Uso, Area, UF, Ano e Ultimo Evento (badge amarelo). Isso permite avaliar rapidamente se a area tem potencial."
      },
      {
        title: "Da ANM ao CRM",
        content: "Ao identificar um processo interessante (ex: uma area de calcario em 'Disponibilidade' no MT), voce pode importar como ativo e criar um deal no CRM para prospectar o titular ou requerer a area."
      }
    ],
    flow: "Filtrar (UF + Substância + Fase) → Ver no Mapa → Clicar Polígono → Analisar Detalhes → Importar como Ativo"
  },
  {
    id: "geo-rural",
    icon: TreePine,
    title: "Prospeccao Rural (Geo-Rural)",
    badge: "Geoespacial",
    badgeColor: "bg-cyan-500/10 text-cyan-600 border-cyan-200",
    summary: "Analise geoespacial de propriedades rurais via SICAR (CAR), com camadas de rios, energia, altitude e score de oportunidade.",
    subsections: [
      {
        title: "O que e o Geo-Rural",
        content: "O modulo Geo-Rural consulta o SICAR (Sistema Nacional de Cadastro Ambiental Rural) e plota propriedades rurais no mapa. Ele calcula um 'Score de Oportunidade' baseado em proximidade de rios, linhas de energia, altitude e tamanho da propriedade."
      },
      {
        title: "Camadas do mapa",
        content: "O mapa pode exibir multiplas camadas: propriedades rurais (poligonos), rios e corpos d'agua, linhas de transmissao de energia, e relevo/altitude. Ativar/desativar camadas ajuda a analisar o potencial da area."
      },
      {
        title: "Filtros rapidos",
        content: "Use os atalhos para buscar grandes fazendas (>1000ha) ou pequenas propriedades. Filtre por UF e municipio. O score gauge mostra a nota da oportunidade baseada nos criterios de proximidade."
      },
      {
        title: "Resiliencia",
        content: "O servidor do SICAR e instavel. O sistema faz ate 3 tentativas automaticas, alterna entre protocolos WFS 2.0 e 1.1, e mostra um botao de 'Tentar novamente' caso o servidor esteja fora do ar."
      }
    ],
    flow: "Selecionar UF/Município → Carregar CAR → Analisar Camadas → Score de Oportunidade → Importar como Ativo"
  },
  {
    id: "relatorios",
    icon: BarChart2,
    title: "Relatorios",
    badge: "Analise",
    badgeColor: "bg-rose-500/10 text-rose-600 border-rose-200",
    summary: "Relatorios analiticos com abas por area: visao geral, empresas, deals e ativos. Graficos, tabelas e metricas detalhadas.",
    subsections: [
      {
        title: "Abas de relatorio",
        content: "O modulo tem 4 abas: Geral (KPIs consolidados, graficos de evolucao), Empresas (distribuicao por porte, estado, setor), Deals (funil de conversao, valor medio, taxa de fechamento), Ativos (distribuicao por tipo, valor medio, localizacao)."
      },
      {
        title: "Como usar",
        content: "Os relatorios sao gerados automaticamente com base nos dados do sistema. Use para acompanhar a performance da equipe, identificar gargalos no pipeline e reportar resultados para a diretoria."
      }
    ]
  },
  {
    id: "contratos",
    icon: FileSignature,
    title: "Contratos",
    badge: "Comercial",
    badgeColor: "bg-indigo-500/10 text-indigo-600 border-indigo-200",
    summary: "Crie templates de contratos com variaveis dinamicas e gere documentos prontos para assinatura com exportacao PDF.",
    subsections: [
      {
        title: "O que sao Contratos",
        content: "O modulo de Contratos funciona igual ao de Propostas: voce cria templates com editor visual (Tiptap), insere variaveis como {{empresa.nome}}, {{ativo.titulo}}, {{contrato.foro}}, e depois gera o contrato final com os dados reais preenchidos automaticamente."
      },
      {
        title: "Tipos de contrato",
        content: "Existem 5 tipos: Compra e Venda, Cessao de Direitos, NDA (Acordo de Confidencialidade), Parceria e Custom (personalizado). Cada tipo serve como tag organizacional para facilitar a busca."
      },
      {
        title: "Variaveis disponiveis",
        content: "Sao 6 grupos de variaveis: Empresa (nome, CNPJ, endereco, etc.), Ativo (titulo, tipo, area, preco, etc.), Investidor (nome, perfil, contato), Minha Empresa (nome, CNPJ, responsavel), Data (hoje, extenso, ano) e Contrato (valor, prazo, foro, garantia, objeto)."
      },
      {
        title: "Gerar contrato",
        content: "Na aba 'Contratos Gerados', clique em 'Gerar Contrato'. Selecione um template, a empresa, o ativo (opcional) e preencha campos como foro, prazo e valor. O sistema substitui todas as variaveis e gera o documento final."
      },
      {
        title: "Exportar PDF",
        content: "Apos gerar o contrato, voce pode visualiza-lo e exportar como PDF para envio ou assinatura. O PDF mantem a formatacao do editor."
      }
    ],
    flow: "Criar Template → Inserir Variáveis → Gerar Contrato (empresa + ativo) → Preview → Exportar PDF"
  },
  {
    id: "portal-investidor",
    icon: Globe,
    title: "Portal do Investidor",
    badge: "Comercial",
    badgeColor: "bg-indigo-500/10 text-indigo-600 border-indigo-200",
    summary: "Portal publico para apresentar oportunidades de investimento. Investidores demonstram interesse e seus dados sao rastreados no painel admin.",
    subsections: [
      {
        title: "O que e o Portal",
        content: "O Portal do Investidor e uma pagina publica (acessivel sem login) que apresenta os ativos/negocios publicados pela equipe. Investidores interessados preenchem um formulario com nome, email, telefone e empresa para demonstrar interesse."
      },
      {
        title: "Nivel de visibilidade",
        content: "Cada publicacao pode ter nivel 'Teaser' (mostra tipo, regiao e area, valor aparece como 'Sob consulta') ou 'Completo' (mostra todos os dados publicos incluindo valor). Dados sensiveis como matricula e empresa proprietaria nunca sao expostos."
      },
      {
        title: "Admin do Portal",
        content: "No painel interno (/portal-admin), voce gerencia as publicacoes: criar nova publicacao vinculada a um ativo, publicar/arquivar, e acompanhar os interessados que enviaram formulario. Cada interessado pode ter status: Novo, Contatado ou Fechado."
      },
      {
        title: "Conformidade legal",
        content: "O portal segue boas praticas para o mercado brasileiro: teasers publicos com acesso completo mediante cadastro, rastreabilidade dos interessados, e dados sensiveis protegidos. Isso atende requisitos de LGPD e regulacao CVM para apresentacao de oportunidades."
      }
    ],
    flow: "Admin publica ativo → Portal exibe teaser → Investidor preenche formulário → Admin recebe no painel → Contato e negociação"
  },
  {
    id: "status-servicos",
    icon: Activity,
    title: "Status de Servicos Externos",
    badge: "Sistema",
    badgeColor: "bg-gray-500/10 text-gray-600 border-gray-200",
    summary: "Indicadores visuais no sidebar mostram se os servicos externos (ANM e SICAR) estao disponiveis.",
    subsections: [
      {
        title: "Como funciona",
        content: "O sistema verifica a cada 60 segundos se os servidores da ANM (geo.anm.gov.br) e do SICAR (geoserver.car.gov.br) estao respondendo. O resultado aparece como uma bolinha verde (online) ou amarela com icone de alerta (indisponivel) ao lado dos itens 'Portal ANM' e 'Prospeccao Rural' no menu lateral."
      },
      {
        title: "Instabilidade do SICAR",
        content: "O servidor do SICAR e reconhecidamente instavel. E comum aparecer como 'offline'. Quando isso acontece, voce ainda pode tentar acessar o modulo Geo-Rural — o sistema faz ate 3 tentativas automaticas e alterna entre protocolos WFS."
      }
    ]
  },
  {
    id: "connectors",
    icon: Plug,
    title: "Connectors",
    badge: "Sistema",
    badgeColor: "bg-gray-500/10 text-gray-600 border-gray-200",
    summary: "Gerenciamento de fontes de dados externas e jobs automatizados. Permite configurar, executar e monitorar conectores.",
    subsections: [
      {
        title: "O que sao Connectors",
        content: "Connectors sao integracoes com fontes de dados externas (APIs, planilhas, scrapers). Cada conector pode ser configurado com parametros JSON, executado manualmente ou agendado. O status mostra a ultima execucao e se foi bem-sucedida."
      },
      {
        title: "Quando usar",
        content: "Use quando precisar importar dados em massa de fontes externas, configurar scrapers automaticos ou integrar com outros sistemas. Este modulo e voltado para administradores."
      }
    ]
  },
  {
    id: "users",
    icon: Users,
    title: "Usuarios e Permissoes",
    badge: "Sistema",
    badgeColor: "bg-gray-500/10 text-gray-600 border-gray-200",
    summary: "Gerenciamento de usuarios com controle de acesso baseado em papeis (RBAC): Admin, Manager e SDR.",
    subsections: [
      {
        title: "Papeis e permissoes",
        content: "Admin: acesso total a todos os modulos, incluindo Connectors, Usuarios e Configuracoes. Manager: acesso a Dashboard, Prospeccao, Empresas, SDR, CRM, Matching, Ativos e Propostas. SDR: acesso limitado a Dashboard, Prospeccao, Empresas e SDR Queue. As permissoes podem ser customizadas por usuario."
      },
      {
        title: "Gerenciar usuarios",
        content: "Nesta pagina voce pode criar novos usuarios, alterar papeis, customizar permissoes individuais e configurar assinaturas de email."
      }
    ]
  },
  {
    id: "configuracoes",
    icon: Settings2,
    title: "Configuracoes",
    badge: "Sistema",
    badgeColor: "bg-gray-500/10 text-gray-600 border-gray-200",
    summary: "Configuracoes gerais do sistema: nome da empresa, logo, preferencias de idioma e tema.",
    subsections: [
      {
        title: "O que configurar",
        content: "Nesta pagina voce define o nome da sua empresa (usado nas propostas com {{minha_empresa.nome}}), a URL do logo, e outras preferencias gerais do sistema."
      }
    ]
  },
  {
    id: "error-reports",
    icon: Bug,
    title: "Erros e Relatorios",
    badge: "Sistema",
    badgeColor: "bg-red-500/10 text-red-600 border-red-200",
    summary: "Sistema completo de reporte e rastreamento de bugs durante o periodo de testes, com captura automatica de erros.",
    subsections: [
      {
        title: "Reportar Bug",
        content: "Qualquer usuario pode reportar um bug clicando no botao 'Reportar Bug' na barra superior. O formulario permite descrever o problema, selecionar o modulo afetado e definir a prioridade (Baixa, Media, Alta, Critica). Informacoes como pagina atual, usuario e navegador sao incluidas automaticamente."
      },
      {
        title: "Captura Automatica",
        content: "O sistema captura automaticamente erros de requisicoes que falham (status 400+), erros de JavaScript nao tratados e rejeicoes de Promise. Esses erros aparecem no painel com o tipo 'Auto' e incluem detalhes tecnicos como URL, metodo HTTP, status code e stack trace."
      },
      {
        title: "Painel de Erros",
        content: "O painel de gerenciamento (acessivel pelo menu lateral em Sistema > Erros e Relatorios) mostra todos os erros com filtros por status, prioridade e tipo. Cada erro pode ser marcado como 'Em Analise', 'Resolvido' ou 'Fechado'. Cards de estatisticas no topo mostram totais, abertos, resolvidos e auto-capturados."
      },
      {
        title: "Notificacoes",
        content: "O sino de notificacoes na barra superior mostra a quantidade de erros pendentes em tempo real. Ao clicar, um menu dropdown lista os erros mais recentes com links diretos para o painel de gerenciamento."
      }
    ]
  },
];

const FLUXO_COMPLETO = [
  { step: "1", label: "Prospectar", desc: "Buscar empresas por CNPJ, CNAE ou filtros avancados", module: "prospeccao" },
  { step: "2", label: "Importar Lead", desc: "Salvar a empresa na base e enviar para a fila SDR", module: "empresas" },
  { step: "3", label: "Qualificar (SDR)", desc: "Pesquisar, verificar contato, preencher Dados Verificados", module: "sdr" },
  { step: "4", label: "Promover a Deal", desc: "Criar deal no CRM com dados verificados pre-preenchidos", module: "crm" },
  { step: "5", label: "Cadastrar Ativo", desc: "Registrar o imovel/mina/negocio com preco e detalhes", module: "ativos" },
  { step: "6", label: "Matching", desc: "Rodar o motor para casar ativo com investidor ideal", module: "matching" },
  { step: "7", label: "Proposta", desc: "Gerar documento comercial com dados reais e exportar PDF", module: "propostas" },
  { step: "8", label: "Contrato", desc: "Gerar contrato com template e variaveis preenchidas", module: "contratos" },
  { step: "9", label: "Portal", desc: "Publicar ativo no portal para captar investidores", module: "portal-investidor" },
  { step: "10", label: "Fechar", desc: "Mover deal no Kanban ate o fechamento", module: "crm" },
];

function SectionCard({ section, isExpanded, onToggle }: {
  section: Section; isExpanded: boolean; onToggle: () => void;
}) {
  const Icon = section.icon;
  return (
    <Card
      className={cn(
        "transition-all duration-200 border",
        isExpanded ? "ring-2 ring-primary/20 shadow-lg" : "hover:shadow-md"
      )}
      data-testid={`manual-section-${section.id}`}
    >
      <CardHeader
        className="cursor-pointer select-none"
        onClick={onToggle}
      >
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-muted shrink-0">
            <Icon className="w-5 h-5 text-foreground/70" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <CardTitle className="text-lg">{section.title}</CardTitle>
              {section.badge && (
                <Badge variant="outline" className={cn("text-[10px] font-semibold", section.badgeColor)}>
                  {section.badge}
                </Badge>
              )}
            </div>
            <CardDescription className="text-sm leading-relaxed">
              {section.summary}
            </CardDescription>
          </div>
          <div className="shrink-0 mt-1">
            {isExpanded
              ? <ChevronDown className="w-5 h-5 text-muted-foreground" />
              : <ChevronRight className="w-5 h-5 text-muted-foreground" />
            }
          </div>
        </div>
      </CardHeader>
      {isExpanded && (
        <CardContent className="pt-0 space-y-5">
          {section.flow && (
            <div className="p-3 rounded-lg bg-primary/5 border border-primary/10">
              <p className="text-[10px] font-bold uppercase tracking-wider text-primary/60 mb-1.5">Fluxo</p>
              <p className="text-sm font-medium text-primary">{section.flow}</p>
            </div>
          )}
          {section.subsections.map((sub, i) => (
            <div key={i} className="space-y-1.5">
              <h4 className="font-semibold text-sm text-foreground" data-testid={`text-subsection-title-${section.id}-${i}`}>{sub.title}</h4>
              <p className="text-sm text-muted-foreground leading-relaxed" data-testid={`text-subsection-content-${section.id}-${i}`}>{sub.content}</p>
            </div>
          ))}
        </CardContent>
      )}
    </Card>
  );
}

export default function ManualPage() {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  const toggleSection = (id: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandAll = () => setExpandedSections(new Set(MANUAL_SECTIONS.map(s => s.id)));
  const collapseAll = () => setExpandedSections(new Set());

  const filteredSections = MANUAL_SECTIONS.filter(s => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      s.title.toLowerCase().includes(q) ||
      s.summary.toLowerCase().includes(q) ||
      s.id.toLowerCase().includes(q) ||
      s.subsections.some(sub =>
        sub.title.toLowerCase().includes(q) || sub.content.toLowerCase().includes(q)
      )
    );
  });

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-6">
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10">
            <BookOpen className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-display font-bold" data-testid="text-manual-title">
              Manual do Sistema
            </h1>
            <p className="text-muted-foreground text-sm mt-0.5" data-testid="text-manual-subtitle">
              Guia completo de todos os modulos do Mavrion Connect
            </p>
          </div>
        </div>
      </div>

      <Card className="border-primary/20 bg-primary/[0.02]">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" />
            Fluxo Completo de Operacao
          </CardTitle>
          <CardDescription>
            Da prospeccao ao fechamento — como os modulos se conectam
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {FLUXO_COMPLETO.map((item, i) => (
              <div key={i} className="relative">
                <div
                  className="p-3 rounded-lg border bg-background hover:bg-muted/50 transition-colors cursor-pointer"
                  onClick={() => {
                    setExpandedSections(new Set([item.module]));
                    document.getElementById(`manual-section-${item.module}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
                  }}
                  data-testid={`flow-step-${item.step}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="w-5 h-5 rounded-full bg-primary text-white text-xs font-bold flex items-center justify-center shrink-0">
                      {item.step}
                    </span>
                    <span className="text-sm font-semibold">{item.label}</span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{item.desc}</p>
                </div>
                {i < FLUXO_COMPLETO.length - 1 && i % 4 !== 3 && (
                  <ArrowRight className="hidden sm:block absolute -right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/30 z-10" />
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar no manual... (ex: matching, proposta, CNPJ)"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-manual-search"
          />
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={expandAll}
          className="text-xs whitespace-nowrap"
          data-testid="button-expand-all"
        >
          Expandir tudo
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={collapseAll}
          className="text-xs text-muted-foreground whitespace-nowrap"
          data-testid="button-collapse-all"
        >
          Recolher
        </Button>
      </div>

      <div className="space-y-4">
        {filteredSections.map(section => (
          <div key={section.id} id={`manual-section-${section.id}`}>
            <SectionCard
              section={section}
              isExpanded={expandedSections.has(section.id)}
              onToggle={() => toggleSection(section.id)}
            />
          </div>
        ))}
        {filteredSections.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <Search className="w-10 h-10 mx-auto mb-3 opacity-20" />
            <p className="text-lg font-medium" data-testid="text-no-results">Nenhum resultado encontrado</p>
            <p className="text-sm mt-1" data-testid="text-no-results-hint">Tente buscar por outro termo</p>
          </div>
        )}
      </div>
    </div>
  );
}

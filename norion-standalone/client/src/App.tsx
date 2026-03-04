import { Switch, Route, useLocation } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { useAuth } from "@/hooks/use-auth";

import NorionLoginPage from "@/pages/login";
import NorionDashboardPage from "@/pages/dashboard";
import NorionOperacoesPage from "@/pages/operacoes";
import NorionEmpresasPage from "@/pages/empresas";
import NorionEmpresaNovaPage from "@/pages/empresa-nova";
import NorionEmpresaDetalhePage from "@/pages/empresa-detalhe";
import NorionSdrPage from "@/pages/sdr";
import NorionFundosParceirosPage from "@/pages/fundos-parceiros";
import NorionFundoNovoPage from "@/pages/fundo-novo";
import NorionFundoDetalhePage from "@/pages/fundo-detalhe";
import NorionConsultaFundosPage from "@/pages/consulta-fundos";
import NorionRelatorioPage from "@/pages/relatorio";
import NorionConfiguracoesPage from "@/pages/configuracoes";
import NorionCafPage from "@/pages/caf";
import CafNovoPage from "@/pages/caf-novo";
import CafDetalhePage from "@/pages/caf-detalhe";
import CafCrawlerPage from "@/pages/caf-crawler";
import CafSicorPage from "@/pages/caf-sicor";
import CafImportarPage from "@/pages/caf-importar";
import NorionOperacaoNovaPage from "@/pages/operacao-nova";
import NorionOperacaoDetalhePage from "@/pages/operacao-detalhe";
import NorionPortalClientesAdminPage from "@/pages/portal-clientes-admin";
import NorionSidebar, { NorionSidebarProvider, NorionMobileTopBar } from "@/components/norion-layout";
import PortalClienteLogin from "@/pages/portal-cliente";
import PortalClienteDashboard from "@/pages/portal-cliente-dashboard";
import PortalClienteFormulario from "@/pages/portal-cliente-formulario";

function NorionAuthGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();
  if (isLoading) return <div className="min-h-screen flex items-center justify-center bg-[#0f172a] text-white">Carregando...</div>;
  if (!user) { setLocation("/login"); return null; }
  return <>{children}</>;
}

function NorionShell({ children }: { children: React.ReactNode }) {
  return (
    <NorionAuthGuard>
      <NorionSidebarProvider>
        <NorionSidebar />
        <NorionMobileTopBar />
        <main className="pt-16 min-h-screen bg-[#0f172a]">
          {children}
        </main>
      </NorionSidebarProvider>
    </NorionAuthGuard>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/portal-cliente/formulario" component={PortalClienteFormulario} />
      <Route path="/portal-cliente/dashboard" component={PortalClienteDashboard} />
      <Route path="/portal-cliente" component={PortalClienteLogin} />

      <Route path="/login" component={NorionLoginPage} />

      <Route path="/">
        <NorionShell><NorionDashboardPage /></NorionShell>
      </Route>
      <Route path="/operacoes/nova">
        <NorionShell><NorionOperacaoNovaPage /></NorionShell>
      </Route>
      <Route path="/operacoes/:id">
        <NorionShell><NorionOperacaoDetalhePage /></NorionShell>
      </Route>
      <Route path="/operacoes">
        <NorionShell><NorionOperacoesPage /></NorionShell>
      </Route>
      <Route path="/empresas/nova">
        <NorionShell><NorionEmpresaNovaPage /></NorionShell>
      </Route>
      <Route path="/empresas/:id">
        <NorionShell><NorionEmpresaDetalhePage /></NorionShell>
      </Route>
      <Route path="/empresas">
        <NorionShell><NorionEmpresasPage /></NorionShell>
      </Route>
      <Route path="/sdr">
        <NorionShell><NorionSdrPage /></NorionShell>
      </Route>
      <Route path="/fundos-parceiros/novo">
        <NorionShell><NorionFundoNovoPage /></NorionShell>
      </Route>
      <Route path="/fundos-parceiros/:id">
        <NorionShell><NorionFundoDetalhePage /></NorionShell>
      </Route>
      <Route path="/fundos-parceiros">
        <NorionShell><NorionFundosParceirosPage /></NorionShell>
      </Route>
      <Route path="/consulta-fundos">
        <NorionShell><NorionConsultaFundosPage /></NorionShell>
      </Route>
      <Route path="/relatorio">
        <NorionShell><NorionRelatorioPage /></NorionShell>
      </Route>
      <Route path="/portal-clientes">
        <NorionShell><NorionPortalClientesAdminPage /></NorionShell>
      </Route>
      <Route path="/configuracoes">
        <NorionShell><NorionConfiguracoesPage /></NorionShell>
      </Route>
      <Route path="/caf/novo">
        <NorionShell><CafNovoPage /></NorionShell>
      </Route>
      <Route path="/caf/crawler">
        <NorionShell><CafCrawlerPage /></NorionShell>
      </Route>
      <Route path="/caf/sicor">
        <NorionShell><CafSicorPage /></NorionShell>
      </Route>
      <Route path="/caf/importar">
        <NorionShell><CafImportarPage /></NorionShell>
      </Route>
      <Route path="/caf/:id">
        <NorionShell><CafDetalhePage /></NorionShell>
      </Route>
      <Route path="/caf">
        <NorionShell><NorionCafPage /></NorionShell>
      </Route>
      <Route>
        <div className="min-h-screen flex items-center justify-center bg-[#0f172a] text-white">
          <div className="text-center">
            <h1 className="text-4xl font-bold mb-4">404</h1>
            <p className="text-slate-400">Pagina nao encontrada</p>
          </div>
        </div>
      </Route>
    </Switch>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router />
      <Toaster />
    </QueryClientProvider>
  );
}

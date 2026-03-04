import { Switch, Route, useLocation } from "wouter";
import { useEffect } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";

import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import LoginPage from "@/pages/login";
import SdrQueue from "@/pages/sdr";
import CRMBoard from "@/pages/crm";
import MatchingPage from "@/pages/matching";
import ConnectorsPage from "@/pages/connectors";
import ProspeccaoPage from "@/pages/prospeccao";
import EmpresasPage from "@/pages/empresas";
import EmpresaDetailPage from "@/pages/empresa-detail";
import UsersPage from "@/pages/users";
import PropostasPage from "@/pages/propostas";
import ConfiguracoesPage from "@/pages/configuracoes";
import AtivosPage from "@/pages/ativos";
import AtivoDetalhePage from "@/pages/ativo-detalhe";
import RelatoriosPage from "@/pages/relatorios";
import AnmPage from "@/pages/anm";
import GeoRuralPage from "@/pages/geo-rural";
import AnaliseAgroPage from "@/pages/analise-agro";
import InteligenciaAgroPage from "@/pages/inteligencia-agro";
import ManualPage from "@/pages/manual";
import ContratosPage from "@/pages/contratos";
import PortalAdminPage from "@/pages/portal-admin";
import PortalPublicoPage from "@/pages/portal-publico";
import LandingPagePublic from "@/pages/landing-page";
import ErrorReportsPage from "@/pages/error-reports";
import ArquiteturaPage from "@/pages/arquitetura";
import MADealsPage from "@/pages/ma-deals";
import MapaConexoesPage from "@/pages/mapa-conexoes";
import Sidebar, { SidebarProvider, MobileTopBar } from "@/components/layout-sidebar";
import TopBar from "@/components/top-bar";
import { useErrorCapture } from "@/hooks/use-error-capture";


function PrivateRoute({ component: Component, ...rest }: any) {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && !user) {
      setLocation("/login");
    }
  }, [user, isLoading, setLocation]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <SidebarProvider>
      <ErrorCaptureWrapper />
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <main className="flex-1 md:ml-64 transition-all duration-300">
          <MobileTopBar />
          <div className="pt-14 md:pt-0">
            <TopBar />
            <Component {...rest} />
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}

function ErrorCaptureWrapper() {
  useErrorCapture();
  return null;
}

function RedirectToLogin() {
  const [, setLoc] = useLocation();
  useEffect(() => { setLoc("/login"); }, [setLoc]);
  return null;
}

function Router() {
  return (
    <Switch>
      <Route path="/home" component={RedirectToLogin} />
      <Route path="/login" component={LoginPage} />

      <Route path="/">
        {() => <PrivateRoute component={Dashboard} />}
      </Route>

      <Route path="/sdr">
        {() => <PrivateRoute component={SdrQueue} />}
      </Route>

      <Route path="/crm">
        {() => <PrivateRoute component={CRMBoard} />}
      </Route>

      <Route path="/matching">
        {() => <PrivateRoute component={MatchingPage} />}
      </Route>

      <Route path="/connectors">
        {() => <PrivateRoute component={ConnectorsPage} />}
      </Route>

      <Route path="/prospeccao">
        {() => <PrivateRoute component={ProspeccaoPage} />}
      </Route>

      <Route path="/empresas/leads">
        {() => <PrivateRoute component={EmpresasPage} mode="leads" />}
      </Route>

      <Route path="/empresas/desqualificadas">
        {() => <PrivateRoute component={EmpresasPage} mode="desqualificadas" />}
      </Route>

      <Route path="/empresas">
        {() => <PrivateRoute component={EmpresasPage} mode="all" />}
      </Route>

      <Route path="/empresas/:id">
        {(params) => <PrivateRoute component={EmpresaDetailPage} id={params.id} />}
      </Route>

      <Route path="/users">
        {() => <PrivateRoute component={UsersPage} />}
      </Route>

      <Route path="/propostas">
        {() => <PrivateRoute component={PropostasPage} />}
      </Route>

      <Route path="/configuracoes">
        {() => <PrivateRoute component={ConfiguracoesPage} />}
      </Route>

      <Route path="/relatorios">
        {() => <PrivateRoute component={RelatoriosPage} />}
      </Route>

      <Route path="/ativos/tipo/:tipo">
        {(params) => <PrivateRoute component={AtivosPage} filterType={params.tipo} />}
      </Route>

      <Route path="/ativos/:id">
        {(params) => <PrivateRoute component={AtivoDetalhePage} id={params.id} />}
      </Route>

      <Route path="/ativos">
        {() => <PrivateRoute component={AtivosPage} />}
      </Route>

      <Route path="/anm">
        {() => <PrivateRoute component={AnmPage} />}
      </Route>

      <Route path="/geo-rural">
        {() => <PrivateRoute component={GeoRuralPage} />}
      </Route>

      <Route path="/analise-agro">
        {() => <PrivateRoute component={AnaliseAgroPage} />}
      </Route>

      <Route path="/inteligencia-agro">
        {() => <PrivateRoute component={InteligenciaAgroPage} />}
      </Route>

      <Route path="/contratos">
        {() => <PrivateRoute component={ContratosPage} />}
      </Route>

      <Route path="/portal-admin">
        {() => <PrivateRoute component={PortalAdminPage} />}
      </Route>

      <Route path="/error-reports">
        {() => <PrivateRoute component={ErrorReportsPage} />}
      </Route>

      <Route path="/ma">
        {() => <PrivateRoute component={MADealsPage} />}
      </Route>

      <Route path="/mapa-conexoes">
        {() => <PrivateRoute component={MapaConexoesPage} />}
      </Route>

      <Route path="/lp/:slug">
        {(params) => <LandingPagePublic slug={params.slug} />}
      </Route>

      <Route path="/portal/:id">
        {() => <PortalPublicoPage />}
      </Route>

      <Route path="/portal">
        {() => <PortalPublicoPage />}
      </Route>

      <Route path="/arquitetura">
        {() => <PrivateRoute component={ArquiteturaPage} />}
      </Route>

      <Route path="/manual">
        {() => <PrivateRoute component={ManualPage} />}
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Router />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

import { Switch, Route, useLocation } from "wouter";
import { useEffect, useState } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";
import { useErrorCapture } from "@/hooks/use-error-capture";
import { ThemeProvider } from "@/components/theme-provider";
import { I18nContext, type Lang, getTranslation } from "@/lib/i18n";

import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import LoginPage from "@/pages/login";
import ConnectorsPage from "@/pages/connectors";
import ProspeccaoPage from "@/pages/prospeccao";
import EmpresasPage from "@/pages/empresas";
import EmpresaDetailPage from "@/pages/empresa-detail";
import UsersPage from "@/pages/users";
import ConfiguracoesPage from "@/pages/configuracoes";
import AtivosPage from "@/pages/ativos";
import AtivoDetalhePage from "@/pages/ativo-detalhe";
import RelatoriosPage from "@/pages/relatorios";
import AnmPage from "@/pages/anm";
import GeoRuralPage from "@/pages/geo-rural";
import AnaliseAgroPage from "@/pages/analise-agro";
import InteligenciaAgroPage from "@/pages/inteligencia-agro";
import ManualPage from "@/pages/manual";
import ErrorReportsPage from "@/pages/error-reports";
import ArquiteturaPage from "@/pages/arquitetura";
import IaGuiaPdf from "@/pages/ia-guia-pdf";
import NegociosInvestidoresPage from "@/pages/negocios-investidores";
import SicarWorkerPage from "@/pages/sicar-worker";
import Sidebar, { SidebarProvider, MobileTopBar, useSidebar } from "@/components/layout-sidebar";
import TopBar from "@/components/top-bar";


function MainContent({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebar();
  return (
    <main className={`flex-1 transition-all duration-300 ease-out ${collapsed ? "md:ml-[60px]" : "md:ml-60"}`}>
      {children}
    </main>
  );
}

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
        <MainContent>
          <MobileTopBar />
          <div className="pt-12 md:pt-0">
            <TopBar />
            <Component {...rest} />
          </div>
        </MainContent>
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












      <Route path="/connectors">
        {() => <PrivateRoute component={ConnectorsPage} />}
      </Route>

      <Route path="/prospeccao">
        {() => <PrivateRoute component={ProspeccaoPage} />}
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



      <Route path="/configuracoes">
        {() => <PrivateRoute component={ConfiguracoesPage} />}
      </Route>

      <Route path="/relatorios">
        {() => <PrivateRoute component={RelatoriosPage} />}
      </Route>

      <Route path="/ativos/tipo/NEGOCIO">
        {() => <PrivateRoute component={NegociosInvestidoresPage} />}
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

      {/* <Route path="/fii-fundos">
        {() => <PrivateRoute component={FiiFundosPage} />}
      </Route> — desativado temporariamente */}

      <Route path="/analise-agro">
        {() => <PrivateRoute component={AnaliseAgroPage} />}
      </Route>

      <Route path="/inteligencia-agro">
        {() => <PrivateRoute component={InteligenciaAgroPage} />}
      </Route>





      <Route path="/error-reports">
        {() => <PrivateRoute component={ErrorReportsPage} />}
      </Route>

      <Route path="/ma">
        {() => {
          window.location.replace("/prospeccao");
          return null;
        }}
      </Route>













      <Route path="/sicar-worker">
        {() => <PrivateRoute component={SicarWorkerPage} />}
      </Route>

      <Route path="/arquitetura">
        {() => <PrivateRoute component={ArquiteturaPage} />}
      </Route>

      <Route path="/manual">
        {() => <PrivateRoute component={ManualPage} />}
      </Route>

      <Route path="/ia-guia">
        {() => <PrivateRoute component={IaGuiaPdf} />}
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function I18nProvider({ children }: { children: any }) {
  const [lang, setLangState] = useState<Lang>(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("mavrion-lang") as Lang) || "pt";
    }
    return "pt";
  });

  const setLang = (l: Lang) => {
    setLangState(l);
    localStorage.setItem("mavrion-lang", l);
  };

  const t = (key: string, ...args: (string | number)[]) => getTranslation(lang, key, ...args);

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <I18nProvider>
          <TooltipProvider>
            <Router />
            <Toaster />
          </TooltipProvider>
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;

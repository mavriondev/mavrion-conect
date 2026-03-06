import { useState, useEffect, createContext, useContext } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import {
  LayoutDashboard, Briefcase, LogOut, Magnet, Zap,
  Telescope, Building2, Users, ChevronDown, Download, BadgeCheck,
  XCircle, FileText, FileSignature, Menu, X, Layers, TreePine, Pickaxe,
  Home, Wheat, Factory, Target, Settings2, Plug, Map,
  KanbanSquare, BookOpen, Globe, AlertTriangle, Bug, Handshake,
  DollarSign,
  Network,
  Landmark,
  Sun, Moon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useServiceStatus } from "@/hooks/use-service-status";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useTheme } from "@/components/theme-provider";
import { LanguageSelector } from "@/components/language-selector";
import { useI18n } from "@/lib/i18n";

interface SidebarContextValue {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
}
export const SidebarContext = createContext<SidebarContextValue>({
  open: false,
  setOpen: () => {},
  toggle: () => {},
});
export function useSidebar() { return useContext(SidebarContext); }

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [location] = useLocation();
  useEffect(() => { setOpen(false); }, [location]);
  return (
    <SidebarContext.Provider value={{ open, setOpen, toggle: () => setOpen(o => !o) }}>
      {children}
    </SidebarContext.Provider>
  );
}

type ModuleKey = "dashboard" | "prospeccao" | "empresas" | "sdr" | "crm" | "matching" | "connectors" | "users" | "ativos" | "propostas";
const ROLE_DEFAULTS: Record<string, Record<ModuleKey, boolean>> = {
  admin:   { dashboard: true, prospeccao: true, empresas: true, sdr: true, crm: true, matching: true, connectors: true, users: true, ativos: true, propostas: true },
  manager: { dashboard: true, prospeccao: true, empresas: true, sdr: true, crm: true, matching: true, connectors: false, users: false, ativos: true, propostas: true },
  sdr:     { dashboard: true, prospeccao: true, empresas: true, sdr: true, crm: false, matching: false, connectors: false, users: false, ativos: false, propostas: false },
};
function hasPermission(user: any, module: ModuleKey): boolean {
  if (!user) return false;
  const perms = user.permissions && typeof user.permissions === "object" && Object.keys(user.permissions).length > 0
    ? user.permissions : (ROLE_DEFAULTS[user.role] ?? ROLE_DEFAULTS.sdr);
  return perms[module] ?? false;
}

export function MobileTopBar() {
  const { toggle } = useSidebar();
  return (
    <div className="md:hidden fixed top-0 left-0 right-0 z-40 h-14 bg-sidebar-background border-b border-sidebar-border flex items-center px-4 gap-3 shadow-md">
      <button
        onClick={toggle}
        className="p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
        aria-label="Abrir menu"
        data-testid="button-mobile-menu"
      >
        <Menu className="w-5 h-5" />
      </button>
      <div className="flex items-center gap-2 font-bold text-lg text-white">
        <div className="w-6 h-6 rounded-md bg-sidebar-primary flex items-center justify-center">
          <Zap className="w-3.5 h-3.5 text-white fill-current" />
        </div>
        Mavrion Connect
      </div>
    </div>
  );
}

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="px-3 pt-5 pb-1.5 text-[10px] font-bold uppercase tracking-widest text-sidebar-foreground/35 select-none">
      {label}
    </div>
  );
}

function NavLink({ href, icon: Icon, label, exact = true, status }: {
  href: string; icon: any; label: string; exact?: boolean; status?: "online" | "offline";
}) {
  const [location] = useLocation();
  const isActive = exact ? location === href : location.startsWith(href);
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 group",
        isActive
          ? "bg-sidebar-primary text-white shadow-lg shadow-sidebar-primary/20"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-white"
      )}
      data-testid={`nav${href.replace(/\//g, "-") || "-home"}`}
    >
      <Icon className={cn(
        "w-4.5 h-4.5 w-5 h-5 shrink-0 transition-transform group-hover:scale-110",
        isActive ? "text-white" : "text-sidebar-foreground/50 group-hover:text-white"
      )} />
      <span className="flex-1">{label}</span>
      {status && (
        <span title={status === "online" ? "Serviço online" : "Serviço indisponível"}>
          {status === "online" ? (
            <span className="w-2 h-2 rounded-full bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.6)] inline-block" />
          ) : (
            <AlertTriangle className="w-3.5 h-3.5 text-yellow-400 animate-pulse" />
          )}
        </span>
      )}
    </Link>
  );
}

function SubLink({ href, icon: Icon, label, exact = false }: {
  href: string; icon: any; label: string; exact?: boolean;
}) {
  const [location] = useLocation();
  const isActive = exact ? location === href : location === href || location.startsWith(href + "/");
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2.5 pl-9 pr-3 py-2 rounded-lg text-sm transition-all duration-200 group",
        isActive
          ? "bg-sidebar-primary/80 text-white"
          : "text-sidebar-foreground/55 hover:bg-sidebar-accent hover:text-white"
      )}
      data-testid={`nav${href.replace(/\//g, "-")}`}
    >
      <Icon className={cn(
        "w-3.5 h-3.5 shrink-0",
        isActive ? "text-white" : "text-sidebar-foreground/40 group-hover:text-white"
      )} />
      {label}
    </Link>
  );
}

function ExpandableNav({
  href, icon: Icon, label, children, exact = false, activePaths,
}: {
  href: string; icon: any; label: string; children: React.ReactNode; exact?: boolean; activePaths?: string[];
}) {
  const [location] = useLocation();
  const isActive = activePaths
    ? activePaths.some(p => location === p || location.startsWith(p + "/"))
    : (exact ? location === href : location.startsWith(href));
  const [expanded, setExpanded] = useState(isActive);

  return (
    <div>
      <button
        onClick={() => setExpanded(o => !o)}
        className={cn(
          "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 group",
          isActive
            ? "bg-sidebar-primary text-white shadow-lg shadow-sidebar-primary/20"
            : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-white"
        )}
        data-testid={`nav${href.replace(/\//g, "-")}-toggle`}
      >
        <Icon className={cn(
          "w-5 h-5 shrink-0 transition-transform group-hover:scale-110",
          isActive ? "text-white" : "text-sidebar-foreground/50 group-hover:text-white"
        )} />
        <span className="flex-1 text-left">{label}</span>
        <ChevronDown className={cn(
          "w-4 h-4 shrink-0 transition-transform duration-200",
          expanded ? "rotate-180" : ""
        )} />
      </button>
      {expanded && (
        <div className="mt-1 space-y-0.5">
          {children}
        </div>
      )}
    </div>
  );
}

function ThemeToggleButton() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button
      onClick={toggleTheme}
      className="p-1.5 rounded-md text-sidebar-foreground/50 hover:text-white hover:bg-white/10 transition-colors"
      title={theme === "light" ? "Dark mode" : "Light mode"}
      data-testid="btn-theme-toggle"
    >
      {theme === "light" ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
    </button>
  );
}

export default function Sidebar() {
  const { user, logout } = useAuth();
  const { open, setOpen } = useSidebar();
  const { data: serviceStatus } = useServiceStatus();
  const { t } = useI18n();

  const getInitials = (name: string) => name.substring(0, 2).toUpperCase();

  const sidebarContent = (
    <>
      <div className="h-16 flex items-center px-6 border-b border-sidebar-border bg-sidebar-background/50 backdrop-blur-sm shrink-0">
        <div className="flex items-center gap-2 font-bold text-xl tracking-tight text-white flex-1">
          <div className="w-8 h-8 rounded-lg bg-sidebar-primary flex items-center justify-center shrink-0">
            <Zap className="w-5 h-5 text-white fill-current" />
          </div>
          Mavrion Connect
        </div>
        <button
          onClick={() => setOpen(false)}
          className="md:hidden p-1.5 rounded-md text-white/60 hover:text-white hover:bg-white/10 transition-colors"
          aria-label="Fechar menu"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 py-3 px-3 overflow-y-auto space-y-0.5">

        {hasPermission(user, "dashboard") && (
          <NavLink href="/" icon={LayoutDashboard} label={t("nav.dashboard")} exact />
        )}

        {hasPermission(user, "ativos") && (
          <ExpandableNav href="/ativos" icon={Layers} label={t("nav.ativos")}>
            <SubLink href="/ativos" icon={Layers} label={t("nav.ativos")} exact />
            <SubLink href="/ativos/tipo/TERRA" icon={TreePine} label="Terras & Fazendas" />
            <SubLink href="/ativos/tipo/MINA" icon={Pickaxe} label="Mineração" />
            <SubLink href="/ativos/tipo/NEGOCIO" icon={Briefcase} label="Negócios M&A" />
            <SubLink href="/ativos/tipo/FII_CRI" icon={Home} label="FII / CRI / Imóveis" />
            <SubLink href="/ativos/tipo/DESENVOLVIMENTO" icon={Factory} label="Desenvolvimento" />
            <SubLink href="/ativos/tipo/AGRO" icon={Wheat} label="Agronegócio" />
          </ExpandableNav>
        )}

        {hasPermission(user, "matching") && (
          <NavLink href="/matching" icon={Target} label={t("nav.matching")} exact />
        )}

        {hasPermission(user, "matching") && (
          <NavLink href="/mapa-conexoes" icon={Network} label="Mapa de Conexões" />
        )}

        {hasPermission(user, "crm") && (
          <ExpandableNav href="/crm" icon={KanbanSquare} label="CRM" activePaths={["/crm", "/empresas", "/sdr", "/propostas", "/contratos"]}>
            <SubLink href="/crm" icon={KanbanSquare} label={t("nav.kanban")} exact />
            <SubLink href="/empresas" icon={Building2} label={t("nav.empresas")} />
            <SubLink href="/sdr" icon={Magnet} label={t("nav.filaSdr")} />
            <SubLink href="/propostas" icon={FileText} label={t("nav.propostas")} />
            <SubLink href="/contratos" icon={FileSignature} label={t("nav.contratos")} />
          </ExpandableNav>
        )}

        {hasPermission(user, "prospeccao") && (
          <ExpandableNav href="/prospeccao" icon={Telescope} label={t("nav.prospeccao")} activePaths={["/prospeccao", "/ma", "/geo-rural", "/anm", "/fii-fundos"]}>
            <SubLink href="/prospeccao" icon={Telescope} label={t("nav.cnpj")} exact />
            <SubLink href="/ma" icon={Handshake} label={t("nav.maRadar")} />
            <SubLink href="/geo-rural" icon={Map} label={t("nav.geoRural")} />
            <SubLink href="/anm" icon={Pickaxe} label={t("nav.anmBusca")} />
            <SubLink href="/fii-fundos" icon={Landmark} label="FII / Fundos" />
          </ExpandableNav>
        )}

        {hasPermission(user, "crm") && (
          <NavLink href="/portal-admin" icon={Globe} label={t("nav.portal")} />
        )}

        {hasPermission(user, "crm") && (
          <NavLink href="/honorarios" icon={DollarSign} label={t("nav.honorarios")} />
        )}

        {(user?.role === "admin" || user?.role === "manager") ? (
          <ExpandableNav href="/configuracoes" icon={Settings2} label={t("nav.configuracoes")} activePaths={["/configuracoes", "/connectors", "/users", "/error-reports"]}>
            <SubLink href="/configuracoes" icon={Settings2} label="Geral" exact />
            {hasPermission(user, "connectors") && (
              <SubLink href="/connectors" icon={Plug} label="Connectors" />
            )}
            {hasPermission(user, "users") && (
              <SubLink href="/users" icon={Users} label="Usuários" />
            )}
            <SubLink href="/error-reports" icon={Bug} label="Erros & Relatórios" />
          </ExpandableNav>
        ) : (
          <NavLink href="/configuracoes" icon={Settings2} label={t("nav.configuracoes")} />
        )}

      </div>

      <div className="p-4 border-t border-sidebar-border bg-sidebar-accent/30 shrink-0 space-y-3">
        <div className="flex items-center justify-between px-1">
          <LanguageSelector />
          <ThemeToggleButton />
        </div>
        <div className="flex items-center gap-3">
          <Avatar className="h-9 w-9 border border-sidebar-border shadow-sm shrink-0">
            <AvatarFallback className="bg-sidebar-primary text-white font-bold text-sm">
              {user?.username ? getInitials(user.username) : "U"}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate">{user?.username}</p>
            <p className="text-xs text-sidebar-foreground/50 truncate capitalize">{user?.role || "User"}</p>
          </div>
          <button
            onClick={() => logout()}
            className="p-1.5 rounded-md hover:bg-sidebar-accent text-sidebar-foreground/50 hover:text-white transition-colors shrink-0"
            title="Logout"
            data-testid="button-logout"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </>
  );

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-40 w-64 bg-sidebar-background text-sidebar-foreground border-r border-sidebar-border hidden md:flex flex-col shadow-xl">
        {sidebarContent}
      </aside>

      {open && (
        <div
          className="md:hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside className={cn(
        "md:hidden fixed inset-y-0 left-0 z-50 w-72 bg-sidebar-background text-sidebar-foreground flex flex-col shadow-2xl transition-transform duration-300 ease-in-out",
        open ? "translate-x-0" : "-translate-x-full"
      )}>
        {sidebarContent}
      </aside>
    </>
  );
}

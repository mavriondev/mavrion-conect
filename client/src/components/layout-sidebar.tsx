import { useState, useEffect, useRef, createContext, useContext } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { LayoutDashboard, LogOut, Zap, Search, Telescope, Building2, Users, ChevronDown, Menu, X, Layers, TreePine, Pickaxe, Settings2, Plug, Sun, Moon, Bug, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useTheme } from "@/components/theme-provider";
import { LanguageSelector } from "@/components/language-selector";
import { useI18n } from "@/lib/i18n";

interface SidebarContextValue {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  toggleCollapsed: () => void;
}
export const SidebarContext = createContext<SidebarContextValue>({
  open: false,
  setOpen: () => {},
  toggle: () => {},
  collapsed: false,
  setCollapsed: () => {},
  toggleCollapsed: () => {},
});
export function useSidebar() { return useContext(SidebarContext); }

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("sidebar-collapsed") === "true"; } catch { return false; }
  });
  const [location] = useLocation();
  useEffect(() => { setOpen(false); }, [location]);
  const toggleCollapsed = () => {
    setCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem("sidebar-collapsed", String(next)); } catch {}
      return next;
    });
  };
  return (
    <SidebarContext.Provider value={{ open, setOpen, toggle: () => setOpen(o => !o), collapsed, setCollapsed, toggleCollapsed }}>
      {children}
    </SidebarContext.Provider>
  );
}

type ModuleKey = "dashboard" | "prospeccao" | "empresas" | "connectors" | "users" | "ativos" ;
const ROLE_DEFAULTS: Record<string, Record<ModuleKey, boolean>> = {
  admin:    { dashboard: true, prospeccao: true, empresas: true, connectors: true, users: true, ativos: true },
  manager:  { dashboard: true, prospeccao: true, empresas: true, connectors: false, users: false, ativos: true },
  operator: { dashboard: true, prospeccao: true, empresas: true, connectors: false, users: false, ativos: true },
};
function hasPermission(user: any, module: ModuleKey): boolean {
  if (!user) return false;
  const perms = user.permissions && typeof user.permissions === "object" && Object.keys(user.permissions).length > 0
    ? user.permissions : (ROLE_DEFAULTS[user.role] ?? ROLE_DEFAULTS.operator);
  return perms[module] ?? false;
}

export function MobileTopBar() {
  const { toggle } = useSidebar();
  return (
    <div className="md:hidden fixed top-0 left-0 right-0 z-40 h-14 bg-sidebar-background/95 backdrop-blur-xl border-b border-white/[0.06] flex items-center px-4 gap-3">
      <button
        onClick={toggle}
        className="p-2 rounded-xl text-white/60 hover:text-white hover:bg-white/10 transition-all duration-150"
        aria-label="Abrir menu"
        data-testid="button-mobile-menu"
      >
        <Menu className="w-5 h-5" />
      </button>
      <div className="flex items-center gap-2.5 font-semibold text-[15px] text-white tracking-tight">
        <div className="w-7 h-7 rounded-lg bg-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-500/20">
          <Zap className="w-3.5 h-3.5 text-white fill-current" />
        </div>
        Mavrion Connect
      </div>
    </div>
  );
}

function NavLink({ href, icon: Icon, label, exact = true, collapsed = false }: {
  href: string; icon: any; label: string; exact?: boolean; collapsed?: boolean;
}) {
  const [location] = useLocation();
  const isActive = exact ? location === href : location.startsWith(href);
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center rounded-xl text-[13px] font-medium transition-all duration-200 group",
        collapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2.5",
        isActive
          ? "bg-white/[0.12] text-white shadow-sm"
          : "text-white/55 hover:bg-white/[0.07] hover:text-white/90"
      )}
      data-testid={`nav${href.replace(/\//g, "-") || "-home"}`}
      title={collapsed ? label : undefined}
    >
      <Icon className={cn(
        "w-[18px] h-[18px] shrink-0 transition-all duration-200",
        isActive ? "text-emerald-400" : "text-white/40 group-hover:text-white/70"
      )} />
      {!collapsed && <span className="flex-1 truncate">{label}</span>}
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
        "flex items-center gap-2.5 pl-9 pr-3 py-2 rounded-lg text-[13px] transition-all duration-200 group",
        isActive
          ? "text-emerald-400 bg-emerald-400/[0.08]"
          : "text-white/45 hover:text-white/80 hover:bg-white/[0.04]"
      )}
      data-testid={`nav${href.replace(/\//g, "-")}`}
    >
      <Icon className={cn(
        "w-3.5 h-3.5 shrink-0 transition-all duration-200",
        isActive ? "text-emerald-400" : "text-white/35 group-hover:text-white/60"
      )} />
      <span className="truncate">{label}</span>
    </Link>
  );
}

function ExpandableNav({
  href, icon: Icon, label, children, exact = false, activePaths, collapsed = false,
}: {
  href: string; icon: any; label: string; children: React.ReactNode; exact?: boolean; activePaths?: string[]; collapsed?: boolean;
}) {
  const [location] = useLocation();
  const isActive = activePaths
    ? activePaths.some(p => location === p || location.startsWith(p + "/"))
    : (exact ? location === href : location.startsWith(href));
  const [expanded, setExpanded] = useState(isActive);

  const btnRef = useRef<HTMLButtonElement>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [popoverTop, setPopoverTop] = useState(0);
  const hideTimeout = useRef<ReturnType<typeof setTimeout>>();

  const showPopover = () => {
    if (hideTimeout.current) clearTimeout(hideTimeout.current);
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPopoverTop(rect.top);
    }
    setPopoverOpen(true);
  };
  const startHide = () => {
    hideTimeout.current = setTimeout(() => setPopoverOpen(false), 150);
  };
  const cancelHide = () => {
    if (hideTimeout.current) clearTimeout(hideTimeout.current);
  };

  if (collapsed) {
    return (
      <div className="relative">
        <button
          ref={btnRef}
          onMouseEnter={showPopover}
          onMouseLeave={startHide}
          className={cn(
            "w-full flex items-center justify-center py-2.5 rounded-xl text-[13px] font-medium transition-all duration-200 group",
            isActive
              ? "bg-white/[0.12] text-white shadow-sm"
              : "text-white/55 hover:bg-white/[0.07] hover:text-white/90"
          )}
          title={label}
          data-testid={`nav${href.replace(/\//g, "-")}-toggle`}
        >
          <Icon className={cn(
            "w-[18px] h-[18px] shrink-0 transition-all duration-200",
            isActive ? "text-emerald-400" : "text-white/40 group-hover:text-white/70"
          )} />
        </button>
        {popoverOpen && (
          <div
            className="fixed z-[9999]"
            style={{ left: 68, top: popoverTop }}
            onMouseEnter={cancelHide}
            onMouseLeave={startHide}
          >
            <div className="bg-sidebar-background border border-white/[0.08] rounded-xl shadow-xl py-2 px-1 min-w-[180px]">
              <div className="px-2 pb-1.5 mb-1 border-b border-white/[0.06] text-[11px] font-semibold text-white/50 uppercase tracking-wider">
                {label}
              </div>
              <div className="space-y-0.5">
                {children}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={() => setExpanded(o => !o)}
        className={cn(
          "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-200 group",
          isActive
            ? "bg-white/[0.12] text-white shadow-sm"
            : "text-white/55 hover:bg-white/[0.07] hover:text-white/90"
        )}
        data-testid={`nav${href.replace(/\//g, "-")}-toggle`}
      >
        <Icon className={cn(
          "w-[18px] h-[18px] shrink-0 transition-all duration-200",
          isActive ? "text-emerald-400" : "text-white/40 group-hover:text-white/70"
        )} />
        <span className="flex-1 text-left truncate">{label}</span>
        <ChevronDown className={cn(
          "w-3.5 h-3.5 shrink-0 transition-transform duration-300 ease-out text-white/25",
          expanded ? "rotate-180" : ""
        )} />
      </button>
      <div className={cn(
        "overflow-hidden transition-all duration-300 ease-out",
        expanded ? "max-h-96 opacity-100 mt-1" : "max-h-0 opacity-0"
      )}>
        <div className="space-y-0.5 pb-1">
          {children}
        </div>
      </div>
    </div>
  );
}

function ThemeToggleButton() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button
      onClick={toggleTheme}
      className="p-2 rounded-xl text-white/40 hover:text-white/80 hover:bg-white/[0.07] transition-all duration-200"
      title={theme === "light" ? "Dark mode" : "Light mode"}
      data-testid="btn-theme-toggle"
    >
      {theme === "light" ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
    </button>
  );
}

export default function Sidebar() {
  const { user, logout } = useAuth();
  const { open, setOpen, collapsed, toggleCollapsed } = useSidebar();
  const { t } = useI18n();
  const { data: orgSettings } = useQuery({
    queryKey: ["/api/org/settings"],
  });
  const logoUrl = (orgSettings as any)?.logo_url || "";
  const companyName = (orgSettings as any)?.company_name || "Mavrion Connect";
  const faviconSet = useRef(false);

  useEffect(() => {
    if (!logoUrl || faviconSet.current) return;
    faviconSet.current = true;
    const link = document.querySelector("link[rel='icon']") as HTMLLinkElement | null;
    if (link) {
      link.href = logoUrl;
    } else {
      const newLink = document.createElement("link");
      newLink.rel = "icon";
      newLink.href = logoUrl;
      document.head.appendChild(newLink);
    }
  }, [logoUrl]);

  const getInitials = (name: string) => name.substring(0, 2).toUpperCase();

  const sidebarContent = (isCollapsed: boolean = false) => (
    <>
      <div className={cn("h-16 flex items-center border-b border-white/[0.06] shrink-0", isCollapsed ? "px-2 justify-center" : "px-5")}>
        {isCollapsed ? (
          <button
            onClick={toggleCollapsed}
            className="p-2 rounded-xl text-white/40 hover:text-white/80 hover:bg-white/[0.07] transition-all duration-200"
            title="Expandir menu"
            data-testid="button-expand-sidebar"
          >
            <PanelLeftOpen className="w-5 h-5" />
          </button>
        ) : (
          <>
            <div className="flex items-center gap-3 flex-1 min-w-0">
              {logoUrl ? (
                <img src={logoUrl} alt="Logo" className="h-8 w-8 object-contain shrink-0 rounded-xl" data-testid="img-sidebar-logo" />
              ) : (
                <div className="w-8 h-8 rounded-xl bg-emerald-500 flex items-center justify-center shrink-0 shadow-lg shadow-emerald-500/20">
                  <Zap className="w-4 h-4 text-white fill-current" />
                </div>
              )}
              <span className="truncate text-sm font-bold tracking-tight text-white" data-testid="text-sidebar-company">{companyName}</span>
            </div>
            <button
              onClick={toggleCollapsed}
              className="hidden md:block p-2 rounded-xl text-white/40 hover:text-white/80 hover:bg-white/[0.07] transition-all duration-200"
              title="Recolher menu"
              data-testid="button-collapse-sidebar"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
            <button
              onClick={() => setOpen(false)}
              className="md:hidden p-2 rounded-xl text-white/50 hover:text-white hover:bg-white/10 transition-all duration-200"
              aria-label="Fechar menu"
            >
              <X className="w-4 h-4" />
            </button>
          </>
        )}
      </div>

      <div className={cn("flex-1 py-3 overflow-y-auto space-y-1", isCollapsed ? "px-1.5" : "px-3")}>

        {hasPermission(user, "dashboard") && (
          <NavLink href="/" icon={LayoutDashboard} label={t("nav.dashboard")} exact collapsed={isCollapsed} />
        )}

        {hasPermission(user, "prospeccao") && (
          <ExpandableNav href="/prospeccao" icon={Telescope} label={t("nav.prospeccao")} activePaths={["/prospeccao", "/geo-rural", "/anm"]} collapsed={isCollapsed}>
            <SubLink href="/prospeccao" icon={Search} label="Empresas" exact />
            <SubLink href="/geo-rural" icon={TreePine} label="Fazendas" />
            <SubLink href="/anm" icon={Pickaxe} label="Jazidas" />
          </ExpandableNav>
        )}

        {hasPermission(user, "ativos") && (
          <ExpandableNav href="/ativos" icon={Layers} label={t("nav.ativos")} activePaths={["/ativos", "/empresas"]} collapsed={isCollapsed}>
            <SubLink href="/empresas" icon={Building2} label={t("nav.empresas")} />
            <SubLink href="/ativos/tipo/TERRA" icon={TreePine} label="Fazendas" />
            <SubLink href="/ativos/tipo/MINA" icon={Pickaxe} label="Jazidas" />
          </ExpandableNav>
        )}



        {(user?.role === "admin" || user?.role === "manager") ? (
          <ExpandableNav href="/configuracoes" icon={Settings2} label={t("nav.configuracoes")} activePaths={["/configuracoes", "/connectors", "/users", "/error-reports"]} collapsed={isCollapsed}>
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
          <NavLink href="/configuracoes" icon={Settings2} label={t("nav.configuracoes")} collapsed={isCollapsed} />
        )}

      </div>

      <div className={cn("border-t border-white/[0.06] shrink-0", isCollapsed ? "px-1.5 py-3 space-y-2" : "px-4 py-4 space-y-3")}>
        {isCollapsed ? (
          <div className="flex flex-col items-center gap-2.5">
            <ThemeToggleButton />
            <Avatar className="h-8 w-8 border border-white/10" title={user?.username}>
              <AvatarFallback className="bg-emerald-600/80 text-white font-semibold text-[10px]">
                {user?.username ? getInitials(user.username) : "U"}
              </AvatarFallback>
            </Avatar>
            <button
              onClick={() => logout()}
              className="p-2 rounded-xl hover:bg-white/[0.07] text-white/35 hover:text-white/70 transition-all duration-200"
              title="Logout"
              data-testid="button-logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between px-0.5">
              <LanguageSelector />
              <ThemeToggleButton />
            </div>
            <div className="flex items-center gap-3 p-2 rounded-xl hover:bg-white/[0.04] transition-all duration-200">
              <Avatar className="h-9 w-9 border border-white/10 shrink-0">
                <AvatarFallback className="bg-emerald-600/80 text-white font-semibold text-xs">
                  {user?.username ? getInitials(user.username) : "U"}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-white truncate">{user?.username}</p>
                <p className="text-[11px] text-white/35 truncate capitalize">{user?.role || "User"}</p>
              </div>
              <button
                onClick={() => logout()}
                className="p-2 rounded-xl hover:bg-white/[0.07] text-white/35 hover:text-white/70 transition-all duration-200 shrink-0"
                title="Logout"
                data-testid="button-logout"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );

  return (
    <>
      <aside className={cn(
        "fixed inset-y-0 left-0 z-40 bg-sidebar-background text-sidebar-foreground border-r border-white/[0.04] hidden md:flex flex-col transition-all duration-300 ease-out",
        collapsed ? "w-[60px]" : "w-60"
      )}>
        {sidebarContent(collapsed)}
      </aside>

      {open && (
        <div
          className="md:hidden fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside className={cn(
        "md:hidden fixed inset-y-0 left-0 z-50 w-72 bg-sidebar-background text-sidebar-foreground flex flex-col shadow-2xl transition-transform duration-300 ease-out",
        open ? "translate-x-0" : "-translate-x-full"
      )}>
        {sidebarContent(false)}
      </aside>
    </>
  );
}

import { useState, useEffect, useRef, createContext, useContext } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import {
  LayoutDashboard, LogOut, DollarSign,
  Building2, Menu, X, KanbanSquare,
  Settings2, BarChart3, Landmark, Handshake, Magnet,
  ChevronDown, FolderOpen, Briefcase, Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

interface NorionNavContextValue {
  mobileOpen: boolean;
  setMobileOpen: (v: boolean) => void;
  toggle: () => void;
}
const NorionNavContext = createContext<NorionNavContextValue>({
  mobileOpen: false,
  setMobileOpen: () => {},
  toggle: () => {},
});
export function useNorionSidebar() { return useContext(NorionNavContext); }

export function NorionSidebarProvider({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [location] = useLocation();
  useEffect(() => { setMobileOpen(false); }, [location]);
  return (
    <NorionNavContext.Provider value={{ mobileOpen, setMobileOpen, toggle: () => setMobileOpen(o => !o) }}>
      {children}
    </NorionNavContext.Provider>
  );
}

export function NorionMobileTopBar() {
  return null;
}

type NavItem = {
  href: string;
  icon: any;
  label: string;
  exact?: boolean;
};

type NavGroup = {
  icon: any;
  label: string;
  children: NavItem[];
};

type NavEntry = NavItem | NavGroup;

function isGroup(entry: NavEntry): entry is NavGroup {
  return "children" in entry;
}

const navEntries: NavEntry[] = [
  { href: "/", icon: LayoutDashboard, label: "Dashboard", exact: true },
  { href: "/operacoes", icon: KanbanSquare, label: "Operações", exact: false },
  {
    icon: FolderOpen,
    label: "Cadastros",
    children: [
      { href: "/empresas", icon: Building2, label: "Empresas", exact: false },
      { href: "/sdr", icon: Magnet, label: "SDR / Prospecção", exact: false },
    ],
  },
  {
    icon: Briefcase,
    label: "Fundos",
    children: [
      { href: "/fundos-parceiros", icon: Handshake, label: "Fundos Parceiros", exact: false },
      { href: "/consulta-fundos", icon: Landmark, label: "Consulta Fundos", exact: false },
    ],
  },
  { href: "/portal-clientes", icon: Users, label: "Portal Clientes", exact: false },
  { href: "/relatorio", icon: BarChart3, label: "Relatórios", exact: false },
];

function NavLink({ href, icon: Icon, label, exact = true }: NavItem) {
  const [location] = useLocation();
  const isActive = exact ? location === href : location.startsWith(href);
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap",
        isActive
          ? "bg-amber-500 text-white"
          : "text-slate-300/80 hover:bg-white/10 hover:text-white"
      )}
      data-testid={`nav-norion${href.replace(/\//g, "-") || "-home"}`}
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span>{label}</span>
    </Link>
  );
}

function NavDropdown({ icon: Icon, label, children }: NavGroup) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [location] = useLocation();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isGroupActive = children.some((c) =>
    c.exact ? location === c.href : location.startsWith(c.href)
  );

  useEffect(() => { setOpen(false); }, [location]);

  useEffect(() => {
    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); };
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleMouseEnter = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setOpen(true);
  };

  const handleMouseLeave = () => {
    timeoutRef.current = setTimeout(() => setOpen(false), 200);
  };

  return (
    <div
      className="relative"
      ref={ref}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap",
          isGroupActive
            ? "bg-amber-500/20 text-amber-400"
            : "text-slate-300/80 hover:bg-white/10 hover:text-white"
        )}
        data-testid={`nav-norion-dropdown-${label.toLowerCase()}`}
      >
        <Icon className="w-4 h-4 shrink-0" />
        <span>{label}</span>
        <ChevronDown className={cn("w-3 h-3 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 min-w-[200px] bg-[#1e293b] border border-[#334155] rounded-lg shadow-xl py-1 z-[60]">
          {children.map((child) => {
            const isActive = child.exact
              ? location === child.href
              : location.startsWith(child.href);
            const ChildIcon = child.icon;
            return (
              <Link
                key={child.href}
                href={child.href}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-amber-500 text-white"
                    : "text-slate-300 hover:bg-white/10 hover:text-white"
                )}
                data-testid={`nav-norion${child.href.replace(/\//g, "-")}`}
              >
                <ChildIcon className="w-4 h-4 shrink-0" />
                <span>{child.label}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MobileNavLink({ href, icon: Icon, label, exact = true }: NavItem) {
  const [location] = useLocation();
  const isActive = exact ? location === href : location.startsWith(href);
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
        isActive
          ? "bg-amber-500 text-white"
          : "text-slate-300/80 hover:bg-white/10 hover:text-white"
      )}
      data-testid={`nav-norion-mobile${href.replace(/\//g, "-")}`}
    >
      <Icon className="w-5 h-5 shrink-0" />
      <span>{label}</span>
    </Link>
  );
}

function MobileNavGroup({ icon: Icon, label, children }: NavGroup) {
  const [expanded, setExpanded] = useState(false);
  const [location] = useLocation();
  const isGroupActive = children.some((c) =>
    c.exact ? location === c.href : location.startsWith(c.href)
  );

  useEffect(() => {
    if (isGroupActive) setExpanded(true);
  }, [isGroupActive]);

  return (
    <div>
      <button
        onClick={() => setExpanded((o) => !o)}
        className={cn(
          "w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
          isGroupActive
            ? "text-amber-400"
            : "text-slate-300/80 hover:bg-white/10 hover:text-white"
        )}
        data-testid={`nav-norion-mobile-group-${label.toLowerCase()}`}
      >
        <Icon className="w-5 h-5 shrink-0" />
        <span className="flex-1 text-left">{label}</span>
        <ChevronDown className={cn("w-4 h-4 transition-transform", expanded && "rotate-180")} />
      </button>
      {expanded && (
        <div className="ml-4 border-l border-[#334155] pl-2 space-y-0.5">
          {children.map((child) => (
            <MobileNavLink key={child.href} {...child} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function NorionSidebar() {
  const { user, logout } = useAuth();
  const { mobileOpen, setMobileOpen, toggle } = useNorionSidebar();

  const getInitials = (name: string) => name.substring(0, 2).toUpperCase();

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 h-16 bg-[#0f172a] border-b border-[#1e293b] shadow-md">
      <div className="h-full max-w-full px-4 flex items-center gap-4">
        <Link href="/" className="flex items-center gap-2 font-bold text-lg text-white shrink-0" data-testid="link-norion-brand">
          <div className="w-8 h-8 rounded-md bg-amber-500 flex items-center justify-center">
            <DollarSign className="w-5 h-5 text-white" />
          </div>
          <span className="hidden sm:inline">Norion Capital</span>
        </Link>

        <div className="hidden lg:flex items-center gap-1 flex-1 min-w-0">
          {navEntries.map((entry, i) =>
            isGroup(entry) ? (
              <NavDropdown key={i} {...entry} />
            ) : (
              <NavLink key={entry.href} {...entry} />
            )
          )}
        </div>

        <div className="flex items-center gap-3 ml-auto shrink-0">
          <Link
            href="/configuracoes"
            className="hidden lg:flex p-2 rounded-md text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            title="Configurações"
            data-testid="nav-norion-config"
          >
            <Settings2 className="w-4 h-4" />
          </Link>
          <div className="hidden sm:flex items-center gap-2">
            <Avatar className="h-8 w-8 border border-[#1e293b] shrink-0">
              <AvatarFallback className="bg-amber-500 text-white font-bold text-xs">
                {user?.username ? getInitials(user.username) : "U"}
              </AvatarFallback>
            </Avatar>
            <span className="text-sm text-slate-300 hidden md:inline truncate max-w-[120px]">{user?.username}</span>
          </div>
          <button
            onClick={() => logout()}
            className="p-2 rounded-md text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            title="Logout"
            data-testid="button-norion-logout"
          >
            <LogOut className="w-4 h-4" />
          </button>
          <button
            onClick={toggle}
            className="lg:hidden p-2 rounded-md text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Menu"
            data-testid="button-norion-mobile-menu"
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <>
          <div
            className="lg:hidden fixed inset-0 top-16 z-40 bg-black/50"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <div className="lg:hidden fixed left-0 right-0 top-16 z-50 bg-[#0f172a] border-b border-[#1e293b] shadow-lg p-3 space-y-1 max-h-[calc(100vh-4rem)] overflow-y-auto">
            {navEntries.map((entry, i) =>
              isGroup(entry) ? (
                <MobileNavGroup key={i} {...entry} />
              ) : (
                <MobileNavLink key={entry.href} {...entry} />
              )
            )}
            <MobileNavLink
              href="/configuracoes"
              icon={Settings2}
              label="Configurações"
              exact={false}
            />
            <div className="sm:hidden flex items-center gap-2 px-3 py-2 mt-2 border-t border-[#1e293b]">
              <Avatar className="h-8 w-8 border border-[#1e293b] shrink-0">
                <AvatarFallback className="bg-amber-500 text-white font-bold text-xs">
                  {user?.username ? getInitials(user.username) : "U"}
                </AvatarFallback>
              </Avatar>
              <span className="text-sm text-slate-300">{user?.username}</span>
            </div>
          </div>
        </>
      )}
    </nav>
  );
}

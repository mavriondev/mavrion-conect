import { useState } from "react";

export interface SocioCompany {
  taxId: string;
  legalName: string;
  tradeName: string | null;
  role: string;
  since: string;
  status: string | null;
}

export interface Socio {
  name: string;
  role: string;
  since: string;
  taxId?: string;
}

export interface CompanyWithLead {
  id: number;
  legalName: string;
  tradeName: string | null;
  cnpj: string | null;
  cnaePrincipal: string | null;
  cnaeSecundarios: string[];
  porte: string | null;
  phones: string[];
  emails: string[];
  address: {
    street?: string; number?: string; district?: string; city?: string;
    state?: string; zip?: string; country?: { name?: string };
  };
  notes: string | null;
  website: string | null;
  revenueEstimate: number | null;
  createdAt: string;
  lead: { id: number; status: string; score: number; source: string | null } | null;
}

export interface RelationshipData {
  company: CompanyWithLead;
  socios: Socio[];
}

export default function RelationshipGraph({
  company,
  socios,
  expandedCompanies,
  onCompanyClick,
}: {
  company: CompanyWithLead;
  socios: Socio[];
  expandedCompanies: Record<string, SocioCompany[]>;
  onCompanyClick: (c: SocioCompany) => void;
}) {
  const [hovered, setHovered] = useState<string | null>(null);

  const W = 900, H = 560;
  const cx = W / 2, cy = H / 2;
  const hasExpanded = Object.keys(expandedCompanies).length > 0;
  const ring1 = socios.length <= 3 ? 145 : socios.length <= 6 ? 170 : socios.length <= 10 ? 200 : 230;
  const ring2 = ring1 + 130;

  const truncate = (s: string, n: number) => s && s.length > n ? s.substring(0, n) + "\u2026" : (s || "");

  const socioNodes = socios.map((s, i) => {
    const angle = (i / Math.max(socios.length, 1)) * 2 * Math.PI - Math.PI / 2;
    return { ...s, x: cx + ring1 * Math.cos(angle), y: cy + ring1 * Math.sin(angle), id: `s${i}`, angle };
  });

  const companyNodes: Array<SocioCompany & { x: number; y: number; id: string; parentId: string }> = [];
  socioNodes.forEach(sn => {
    const related = expandedCompanies[sn.taxId || ""] || [];
    const spread = Math.PI / 5;
    related.forEach((c, ci) => {
      const offset = (ci - (related.length - 1) / 2) * spread;
      const angle = sn.angle + offset;
      companyNodes.push({
        ...c,
        x: cx + ring2 * Math.cos(angle),
        y: cy + ring2 * Math.sin(angle),
        id: `c${sn.id}${ci}`,
        parentId: sn.id,
      });
    });
  });

  const isHov = (id: string) => hovered === id || hovered === "company";
  const isSocioHov = (id: string) => hovered === id;

  const nameParts = (name: string) => {
    const parts = name.split(" ");
    if (parts.length === 1) return [truncate(name, 11), ""];
    return [truncate(parts[0], 10), truncate(parts[parts.length - 1], 9)];
  };

  return (
    <div className="w-full bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 rounded-xl overflow-hidden border">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto select-none" style={{ maxHeight: 560 }}>
        <defs>
          <radialGradient id="cg" cx="40%" cy="30%" r="70%">
            <stop offset="0%" stopColor="#818cf8" /><stop offset="100%" stopColor="#4338ca" />
          </radialGradient>
          <radialGradient id="sg" cx="40%" cy="30%" r="70%">
            <stop offset="0%" stopColor="#34d399" /><stop offset="100%" stopColor="#047857" />
          </radialGradient>
          <radialGradient id="sgh" cx="40%" cy="30%" r="70%">
            <stop offset="0%" stopColor="#6ee7b7" /><stop offset="100%" stopColor="#059669" />
          </radialGradient>
          <radialGradient id="eg" cx="40%" cy="30%" r="70%">
            <stop offset="0%" stopColor="#fbbf24" /><stop offset="100%" stopColor="#d97706" />
          </radialGradient>
          <radialGradient id="egh" cx="40%" cy="30%" r="70%">
            <stop offset="0%" stopColor="#fcd34d" /><stop offset="100%" stopColor="#f59e0b" />
          </radialGradient>
          <filter id="sh"><feDropShadow dx="0" dy="3" stdDeviation="5" floodColor="#00000020" /></filter>
          <filter id="shh"><feDropShadow dx="0" dy="6" stdDeviation="12" floodColor="#6366f130" /></filter>
        </defs>

        {socios.length > 0 && (
          <circle cx={cx} cy={cy} r={ring1} fill="none" stroke="#e2e8f030" strokeWidth="1.5" strokeDasharray="5 7" />
        )}
        {hasExpanded && companyNodes.length > 0 && (
          <circle cx={cx} cy={cy} r={ring2} fill="none" stroke="#fbbf2420" strokeWidth="1.5" strokeDasharray="5 7" />
        )}

        {socioNodes.map(n => (
          <line key={`lc${n.id}`} x1={cx} y1={cy} x2={n.x} y2={n.y}
            stroke={isHov(n.id) ? "#6366f1" : "#94a3b840"}
            strokeWidth={isHov(n.id) ? 2.5 : 1.5}
            strokeDasharray={isHov(n.id) ? undefined : "6 4"}
            style={{ transition: "all 0.2s ease" }}
          />
        ))}

        {companyNodes.map(cn => {
          const sn = socioNodes.find(s => s.id === cn.parentId);
          if (!sn) return null;
          return (
            <line key={`lsc${cn.id}`} x1={sn.x} y1={sn.y} x2={cn.x} y2={cn.y}
              stroke={hovered === cn.id ? "#f59e0b" : "#fbbf2440"}
              strokeWidth={hovered === cn.id ? 2 : 1.2}
              strokeDasharray="4 5"
              style={{ transition: "all 0.2s ease" }}
            />
          );
        })}

        {companyNodes.map(cn => {
          const [first, last] = nameParts(cn.legalName);
          const isH = hovered === cn.id;
          return (
            <g key={cn.id}
              onMouseEnter={() => setHovered(cn.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => onCompanyClick(cn)}
              style={{ cursor: "pointer" }}
              data-testid={`graph-ext-company-${cn.id}`}
            >
              {isH && <circle cx={cn.x} cy={cn.y} r={26} fill="none" stroke="#f59e0b" strokeWidth="2" strokeDasharray="4 3" />}
              <circle cx={cn.x} cy={cn.y} r={22} fill={isH ? "url(#egh)" : "url(#eg)"}
                filter={isH ? "url(#shh)" : "url(#sh)"} style={{ transition: "all 0.2s ease" }} />
              <text x={cn.x} y={cn.y - 4} textAnchor="middle" dominantBaseline="middle" fill="white" fontSize="7.5" fontWeight="700" fontFamily="system-ui">{first}</text>
              {last && <text x={cn.x} y={cn.y + 6} textAnchor="middle" dominantBaseline="middle" fill="white" fontSize="6.5" fontFamily="system-ui">{last}</text>}
              {isH && (
                <rect x={cn.x - 50} y={cn.y + 27} width="100" height="22" rx="4" fill="white" fillOpacity="0.95" />
              )}
              {isH && (
                <text x={cn.x} y={cn.y + 38} textAnchor="middle" fill="#1e293b" fontSize="7" fontFamily="system-ui">Clique para abrir</text>
              )}
            </g>
          );
        })}

        {socioNodes.map(n => {
          const [first, last] = nameParts(n.name);
          return (
            <g key={n.id}
              onMouseEnter={() => setHovered(n.id)}
              onMouseLeave={() => setHovered(null)}
              style={{ cursor: "default" }}
              data-testid={`graph-socio-${n.id}`}
            >
              {isSocioHov(n.id) && (
                <circle cx={n.x} cy={n.y} r={36} fill="none" stroke="#10b981" strokeWidth="2" strokeDasharray="4 3" />
              )}
              <circle cx={n.x} cy={n.y} r={30} fill={isSocioHov(n.id) ? "url(#sgh)" : "url(#sg)"}
                filter={isSocioHov(n.id) ? "url(#shh)" : "url(#sh)"} style={{ transition: "all 0.2s ease" }} />
              <text x={n.x} y={n.y - 5} textAnchor="middle" dominantBaseline="middle" fill="white" fontSize="8.5" fontWeight="700" fontFamily="system-ui">{first}</text>
              {last && <text x={n.x} y={n.y + 7} textAnchor="middle" dominantBaseline="middle" fill="white" fontSize="7.5" fontFamily="system-ui">{last}</text>}
              <rect x={n.x - 56} y={n.y + 36} width="112" height="30" rx="5" fill="white" fillOpacity="0.9" />
              <text x={n.x} y={n.y + 48} textAnchor="middle" fill="#1e293b" fontSize="8" fontFamily="system-ui" fontWeight="500">{truncate(n.name, 22)}</text>
              <text x={n.x} y={n.y + 60} textAnchor="middle" fill="#64748b" fontSize="7" fontFamily="system-ui">{truncate(n.role, 24)}</text>
            </g>
          );
        })}

        <g onMouseEnter={() => setHovered("company")} onMouseLeave={() => setHovered(null)} style={{ cursor: "default" }}
          data-testid="graph-company">
          {hovered === "company" && (
            <circle cx={cx} cy={cy} r={58} fill="none" stroke="#6366f1" strokeWidth="2" strokeDasharray="4 3" />
          )}
          <circle cx={cx} cy={cy} r={52} fill="url(#cg)" filter={hovered === "company" ? "url(#shh)" : "url(#sh)"}
            style={{ transition: "all 0.2s ease" }} />
          <text x={cx} y={cy - 10} textAnchor="middle" dominantBaseline="middle" fill="white" fontSize="11" fontWeight="800" fontFamily="system-ui">
            {truncate((company.tradeName || company.legalName).split(" ")[0], 14)}
          </text>
          <text x={cx} y={cy + 4} textAnchor="middle" dominantBaseline="middle" fill="white" fontSize="9" fontFamily="system-ui">
            {truncate((company.tradeName || company.legalName).split(" ").slice(1).join(" "), 16)}
          </text>
          {company.porte && (
            <text x={cx} y={cy + 19} textAnchor="middle" dominantBaseline="middle" fill="#a5b4fc" fontSize="7.5" fontFamily="system-ui">
              {company.porte}
            </text>
          )}
        </g>

        {socios.length === 0 && (
          <>
            <text x={cx} y={cy + 90} textAnchor="middle" fill="#94a3b8" fontSize="13" fontFamily="system-ui">Sem sócios registrados na Receita Federal</text>
            <text x={cx} y={cy + 112} textAnchor="middle" fill="#cbd5e1" fontSize="11" fontFamily="system-ui">Pode ser Empresário Individual ou sem membros cadastrados</text>
          </>
        )}

        <g transform={`translate(16, ${H - 44})`}>
          <circle cx={10} cy={10} r={10} fill="url(#cg)" />
          <text x={26} y={14} fontSize="11" fill="#64748b" fontFamily="system-ui">Empresa</text>
          <circle cx={100} cy={10} r={10} fill="url(#sg)" />
          <text x={116} y={14} fontSize="11" fill="#64748b" fontFamily="system-ui">Sócio</text>
          {hasExpanded && (
            <>
              <circle cx={180} cy={10} r={10} fill="url(#eg)" />
              <text x={196} y={14} fontSize="11" fill="#64748b" fontFamily="system-ui">Outras empresas (clicável)</text>
            </>
          )}
        </g>
        <text x={W - 16} y={H - 16} textAnchor="end" fontSize="10" fill="#94a3b8" fontFamily="system-ui">
          {socios.length} sócio{socios.length !== 1 ? "s" : ""}
          {companyNodes.length > 0 ? ` \u00B7 ${companyNodes.length} empresa${companyNodes.length !== 1 ? "s" : ""} externas` : ""}
        </text>
      </svg>
    </div>
  );
}

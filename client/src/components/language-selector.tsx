import { useI18n, type Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function LanguageSelector({ className, size = "sm" }: { className?: string; size?: "sm" | "md" }) {
  const { lang, setLang } = useI18n();
  const sz = size === "md" ? "w-7 h-5" : "w-5 h-3.5";

  return (
    <div className={cn("flex items-center gap-1", className)} data-testid="language-selector">
      <button
        onClick={() => setLang("pt")}
        className={cn("rounded-sm overflow-hidden border transition-all", lang === "pt" ? "border-emerald-500 ring-1 ring-emerald-500/50 opacity-100" : "border-transparent opacity-50 hover:opacity-80")}
        title="Português"
        data-testid="btn-lang-pt"
      >
        <BrazilFlag className={sz} />
      </button>
      <button
        onClick={() => setLang("en")}
        className={cn("rounded-sm overflow-hidden border transition-all", lang === "en" ? "border-emerald-500 ring-1 ring-emerald-500/50 opacity-100" : "border-transparent opacity-50 hover:opacity-80")}
        title="English"
        data-testid="btn-lang-en"
      >
        <USAFlag className={sz} />
      </button>
    </div>
  );
}

function BrazilFlag({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 640 480" className={className}>
      <rect width="640" height="480" fill="#009b3a"/>
      <polygon points="320,39 609,240 320,441 31,240" fill="#fedf00"/>
      <circle cx="320" cy="240" r="90" fill="#002776"/>
      <path d="M230,240 Q320,190 410,240 Q320,210 230,240Z" fill="white"/>
    </svg>
  );
}

function USAFlag({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 640 480" className={className}>
      <rect width="640" height="480" fill="#fff"/>
      <g fill="#b22234">
        {[0,2,4,6,8,10,12].map(i => <rect key={i} y={i*37} width="640" height="37"/>)}
      </g>
      <rect width="256" height="259" fill="#3c3b6e"/>
      <g fill="#fff" fontSize="20">
        {[0,1,2,3,4].map(row =>
          Array.from({length: row % 2 === 0 ? 6 : 5}).map((_, col) =>
            <circle key={`${row}-${col}`} cx={row % 2 === 0 ? 22 + col * 42 : 43 + col * 42} cy={20 + row * 28} r="6"/>
          )
        )}
        {[5,6,7,8].map(row =>
          Array.from({length: row % 2 === 0 ? 6 : 5}).map((_, col) =>
            <circle key={`${row}-${col}`} cx={row % 2 === 0 ? 22 + col * 42 : 43 + col * 42} cy={20 + row * 28} r="6"/>
          )
        )}
      </g>
    </svg>
  );
}

import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Zap, DollarSign, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();

  const panels = [
    {
      id: "mavrion",
      title: "Mavrion Conect",
      subtitle: "Deal Origination",
      description: "Plataforma completa de originação de deals B2B — SDR, CRM, matching, ativos, prospecção e portal do investidor.",
      icon: Zap,
      gradient: "from-emerald-500 to-emerald-700",
      shadow: "shadow-emerald-500/25",
      bg: "hover:border-emerald-400/50",
      href: user ? "/" : "/login",
      testId: "card-panel-mavrion",
    },
    {
      id: "norion",
      title: "Norion Capital",
      subtitle: "Operações Financeiras",
      description: "Gestão de operações de crédito — Home Equity, fundos parceiros, matching, checklist documental e comissões.",
      icon: DollarSign,
      gradient: "from-amber-500 to-amber-700",
      shadow: "shadow-amber-500/25",
      bg: "hover:border-amber-400/50",
      href: user ? "/norion-app" : "/norion-app/login",
      testId: "card-panel-norion",
    },
  ];

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#0a0a0f] relative overflow-hidden px-4 py-12">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,_var(--tw-gradient-stops))] from-emerald-950/30 via-transparent to-transparent" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,_var(--tw-gradient-stops))] from-amber-950/20 via-transparent to-transparent" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-white/[0.02] to-transparent" />

      <div className="relative z-10 text-center mb-12">
        <div className="flex items-center justify-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-white/10 to-white/5 border border-white/10 flex items-center justify-center">
            <span className="text-white font-bold text-lg">M</span>
          </div>
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight" data-testid="text-home-title">
          Bem-vindo
        </h1>
        <p className="text-sm sm:text-base text-slate-400 mt-2 max-w-md mx-auto">
          Selecione o painel que deseja acessar
        </p>
      </div>

      <div className="relative z-10 grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl w-full">
        {panels.map((panel) => {
          const Icon = panel.icon;
          return (
            <Card
              key={panel.id}
              className={`group cursor-pointer bg-white/[0.03] border-white/[0.08] backdrop-blur-sm transition-all duration-300 ${panel.bg} hover:bg-white/[0.06] hover:shadow-2xl hover:-translate-y-1`}
              onClick={() => setLocation(panel.href)}
              data-testid={panel.testId}
            >
              <CardContent className="p-8 flex flex-col items-center text-center space-y-5">
                <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${panel.gradient} flex items-center justify-center shadow-lg ${panel.shadow} group-hover:scale-110 transition-transform duration-300`}>
                  <Icon className="w-8 h-8 text-white" />
                </div>

                <div className="space-y-1.5">
                  <h2 className="text-xl font-bold text-white">{panel.title}</h2>
                  <p className="text-xs font-semibold tracking-widest uppercase text-slate-500">{panel.subtitle}</p>
                </div>

                <p className="text-sm text-slate-400 leading-relaxed">{panel.description}</p>

                <Button
                  variant="ghost"
                  className="text-slate-400 group-hover:text-white transition-colors mt-2"
                  data-testid={`button-access-${panel.id}`}
                >
                  Acessar
                  <ArrowRight className="w-4 h-4 ml-1.5 group-hover:translate-x-1 transition-transform" />
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <p className="relative z-10 text-[11px] text-slate-600 mt-12">
        © {new Date().getFullYear()} Mavrion Group
      </p>
    </div>
  );
}

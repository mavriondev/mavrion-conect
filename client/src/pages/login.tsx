import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Zap, Loader2, BarChart3, Globe2, Shield, TrendingUp } from "lucide-react";
import loginHeroPath from "@assets/login-hero.png";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const { login, isLoggingIn, user } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (user) {
      setLocation("/");
    }
  }, [user, setLocation]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    login({ username, password });
  };

  const features = [
    { icon: BarChart3, text: "CRM dual-pipeline com matching inteligente" },
    { icon: Globe2, text: "Prospecção rural, minerária e M&A integrada" },
    { icon: Shield, text: "Due diligence automatizada e compliance" },
    { icon: TrendingUp, text: "Inteligência agro com dados SoilGrids e Embrapa" },
  ];

  return (
    <div className="min-h-screen w-full flex" data-testid="page-login">
      <div className="hidden lg:flex lg:w-[55%] relative overflow-hidden">
        <img
          src={loginHeroPath}
          alt="Mavrion Connect"
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#062b1e]/95 via-[#062b1e]/80 to-[#062b1e]/40" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#041f15]/90 via-transparent to-[#041f15]/60" />

        <div className="relative z-10 flex flex-col justify-between p-12 xl:p-16 w-full">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 bg-emerald-500 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/30">
              <Zap className="w-6 h-6 text-white fill-current" />
            </div>
            <div>
              <span className="text-white font-bold text-lg tracking-tight">Mavrion Connect</span>
              <p className="text-emerald-400/80 text-[11px] font-medium tracking-widest uppercase -mt-0.5">Deal Origination</p>
            </div>
          </div>

          <div className="space-y-8 max-w-lg">
            <div className="space-y-4">
              <h1 className="text-4xl xl:text-5xl font-bold text-white leading-[1.1] tracking-tight">
                Inteligência para
                <span className="block text-emerald-400">originação de deals</span>
              </h1>
              <p className="text-base text-slate-300/90 leading-relaxed max-w-md">
                Plataforma completa de deal origination B2B — prospecção de terras, minas e negócios,
                CRM inteligente, matching automatizado e análise de ativos com dados geoespaciais.
              </p>
            </div>

            <div className="space-y-4">
              {features.map((f, i) => {
                const Icon = f.icon;
                return (
                  <div key={i} className="flex items-center gap-3.5 group">
                    <div className="w-9 h-9 rounded-lg bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center flex-shrink-0 group-hover:bg-emerald-500/25 transition-colors">
                      <Icon className="w-4.5 h-4.5 text-emerald-400" />
                    </div>
                    <span className="text-sm text-slate-300/90">{f.text}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="flex -space-x-2">
              {["bg-emerald-500", "bg-teal-500", "bg-cyan-500"].map((bg, i) => (
                <div key={i} className={`w-8 h-8 rounded-full ${bg} border-2 border-[#062b1e] flex items-center justify-center`}>
                  <span className="text-[10px] font-bold text-white">{["MG", "SP", "MT"][i]}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-400">
              Operando em <span className="text-emerald-400 font-semibold">todo o Brasil</span> — terras, mineração, M&A e crédito rural
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center bg-[#fafbfc] dark:bg-[#0a0f0d] px-6 py-12 relative">
        <div className="absolute inset-0 -z-10 overflow-hidden">
          <div className="absolute -top-40 -right-40 w-96 h-96 rounded-full bg-emerald-500/5 blur-3xl" />
          <div className="absolute -bottom-40 -left-40 w-96 h-96 rounded-full bg-teal-500/5 blur-3xl" />
        </div>

        <div className="w-full max-w-[400px] space-y-8">
          <div className="lg:hidden flex items-center gap-2.5 mb-2">
            <div className="w-9 h-9 bg-emerald-500 rounded-xl flex items-center justify-center">
              <Zap className="w-5 h-5 text-white fill-current" />
            </div>
            <span className="text-lg font-bold tracking-tight">Mavrion Connect</span>
          </div>

          <div className="space-y-2">
            <h2 className="text-2xl font-bold tracking-tight text-foreground" data-testid="text-login-title">
              Bem-vindo de volta
            </h2>
            <p className="text-sm text-muted-foreground">
              Entre com suas credenciais para acessar a plataforma
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="username" className="text-sm font-medium">Usuário</Label>
              <Input
                id="username"
                data-testid="input-username"
                type="text"
                placeholder="Digite seu usuário"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="h-11 bg-white dark:bg-white/5 border-border/60 focus:border-emerald-500 focus:ring-emerald-500/20 transition-colors"
                required
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm font-medium">Senha</Label>
              <Input
                id="password"
                data-testid="input-password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-11 bg-white dark:bg-white/5 border-border/60 focus:border-emerald-500 focus:ring-emerald-500/20 transition-colors"
                required
              />
            </div>

            <Button
              type="submit"
              data-testid="button-login"
              className="w-full h-11 text-base font-semibold bg-emerald-600 hover:bg-emerald-700 shadow-lg shadow-emerald-600/20 hover:shadow-emerald-700/30 transition-all"
              disabled={isLoggingIn}
            >
              {isLoggingIn ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Entrando...
                </>
              ) : (
                "Entrar na plataforma"
              )}
            </Button>
          </form>

          <div className="pt-4 border-t border-border/40">
            <p className="text-[11px] text-center text-muted-foreground/70">
              Plataforma segura — Mavrion Connect © {new Date().getFullYear()}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

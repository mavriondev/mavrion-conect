import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Zap, Loader2 } from "lucide-react";

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

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background relative overflow-hidden">
      <div className="absolute inset-0 -z-10"
        style={{ background: "radial-gradient(ellipse at 70% 20%, hsl(142 72% 38% / 0.12) 0%, transparent 60%), radial-gradient(ellipse at 20% 80%, hsl(162 68% 38% / 0.10) 0%, transparent 60%)" }}
      />

      <Card className="w-full max-w-md shadow-2xl border-border/60 bg-card/90 backdrop-blur-xl">
        <CardHeader className="space-y-2 text-center pb-8 pt-10">
          <div className="mx-auto w-14 h-14 bg-primary rounded-2xl flex items-center justify-center mb-5 shadow-lg shadow-primary/30">
            <Zap className="w-8 h-8 text-white fill-current" />
          </div>
          <div className="space-y-1">
            <p className="text-xs font-bold tracking-widest text-primary uppercase">Mavrion Conect</p>
            <CardTitle className="text-2xl font-display font-bold">Bem-vindo de volta</CardTitle>
            <CardDescription className="text-sm text-muted-foreground">
              Entre para acessar sua plataforma de negócios
            </CardDescription>
          </div>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="username">Usuário</Label>
              <Input
                id="username"
                data-testid="input-username"
                type="text"
                placeholder="Digite seu usuário"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="h-11 bg-background/60"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                data-testid="input-password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-11 bg-background/60"
                required
              />
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-4 pt-2 pb-8">
            <Button
              type="submit"
              data-testid="button-login"
              className="w-full h-11 text-base font-semibold shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all"
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
            <p className="text-xs text-center text-muted-foreground">
              Plataforma segura — Mavrion Conect © {new Date().getFullYear()}
            </p>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}

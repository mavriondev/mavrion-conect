import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { AlertTriangle } from "lucide-react";

interface EnrichmentProgressBarProps {
  message?: string;
  icon?: React.ReactNode;
  className?: string;
  slowWarningMs?: number;
}

export function EnrichmentProgressBar({ message = "Consultando dados...", icon, className, slowWarningMs = 15000 }: EnrichmentProgressBarProps) {
  const [fakeProgress, setFakeProgress] = useState(10);
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setFakeProgress(prev => {
        if (prev >= 90) return 90;
        return prev + Math.random() * 8;
      });
    }, 600);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsedMs(prev => prev + 1000);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const isSlow = elapsedMs >= slowWarningMs;

  return (
    <Card className={cn(className)} data-testid="card-enrichment-progress">
      <CardContent className="p-6 space-y-4">
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          {icon}
          <span data-testid="text-progress-message">{message}</span>
        </div>
        <div className="relative">
          <Progress value={fakeProgress} className="h-2" data-testid="progress-bar" />
          <div className="absolute inset-0 h-2 rounded-full overflow-hidden">
            <div className="h-full w-full bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer" />
          </div>
        </div>
        {!isSlow && (
          <p className="text-xs text-center text-muted-foreground opacity-60">
            Isso pode levar alguns segundos...
          </p>
        )}
        {isSlow && (
          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40 px-3 py-2" data-testid="warning-slow-query">
            <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
                Consulta demorando mais que o esperado
              </p>
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                Possível instabilidade nos servidores do governo (INCRA/SIGEF). A consulta continua em andamento...
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

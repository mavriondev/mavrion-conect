import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  trend?: string;
  trendUp?: boolean;
  className?: string;
  index?: number;
}

export function StatCard({ title, value, icon: Icon, trend, trendUp, className, index = 0 }: StatCardProps) {
  return (
    <div 
      className={cn("hover:translate-y-[-2px] transition-transform duration-300", className)}
      style={{ animationDelay: `${index * 100}ms` }}
    >
      <Card className="overflow-hidden border-border/50 shadow-sm hover:shadow-md transition-shadow">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">{title}</p>
              <h3 className="text-3xl font-display font-bold mt-2 text-foreground">{value}</h3>
            </div>
            <div className={cn(
              "p-3 rounded-xl bg-primary/10 text-primary",
              "group-hover:scale-110 transition-transform duration-300"
            )}>
              <Icon className="w-6 h-6" />
            </div>
          </div>
          {trend && (
            <div className="mt-4 flex items-center gap-2 text-sm">
              <span className={cn(
                "font-medium px-1.5 py-0.5 rounded",
                trendUp ? "text-emerald-600 bg-emerald-500/10" : "text-rose-600 bg-rose-500/10"
              )}>
                {trend}
              </span>
              <span className="text-muted-foreground">vs último mês</span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

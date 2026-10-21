import { Card, CardContent } from "@/components/ui/card";
import { DollarSign, Construction } from "lucide-react";

export default function HonorariosPage() {
  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-xl md:text-2xl font-bold" data-testid="text-honorarios-title">Honorários</h1>
        <p className="text-sm text-muted-foreground">Gestão de honorários e comissões por deal</p>
      </div>

      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
            <DollarSign className="w-8 h-8 text-primary" />
          </div>
          <div className="flex items-center gap-2 mb-2">
            <Construction className="w-5 h-5 text-muted-foreground" />
            <h3 className="font-semibold text-lg" data-testid="text-honorarios-status">Em desenvolvimento</h3>
          </div>
          <p className="text-sm text-muted-foreground max-w-md">
            O módulo de honorários permitirá gerenciar comissões, success fees e pagamentos
            vinculados a cada deal fechado no pipeline.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

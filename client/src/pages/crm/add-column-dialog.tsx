import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function AddColumnDialog({ pipelineType, onCreated }: { pipelineType: string; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#94a3b8");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const create = async () => {
    if (!name.trim()) return;
    try {
      await apiRequest("POST", "/api/crm/stages", { name: name.trim(), pipelineType, color });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/stages"] });
      setOpen(false);
      setName("");
      onCreated();
      toast({ title: `Coluna "${name}" criada!` });
    } catch {
      toast({ title: "Erro ao criar coluna", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="flex-shrink-0 w-72 h-12 rounded-xl border-2 border-dashed border-border/60 flex items-center justify-center gap-2 text-sm text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors">
          <Plus className="w-4 h-4" /> Nova Coluna
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Nova Coluna</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label>Nome da coluna</Label>
            <Input
              autoFocus
              placeholder="ex: Análise Jurídica"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") create(); }}
            />
          </div>
          <div className="space-y-2">
            <Label>Cor</Label>
            <div className="flex items-center gap-3">
              <input type="color" value={color} onChange={e => setColor(e.target.value)} className="h-9 w-16 rounded cursor-pointer border" />
              <span className="text-sm text-muted-foreground font-mono">{color}</span>
            </div>
          </div>
          <Button className="w-full" onClick={create}>Criar Coluna</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

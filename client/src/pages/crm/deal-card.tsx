import { Card, CardContent } from "@/components/ui/card";
import { Link } from "wouter";
import {
  GripHorizontal, DollarSign, Building2,
  MessageSquare, Paperclip, Calendar, Flag,
  Mountain, TreePine
} from "lucide-react";
import { Draggable } from "@hello-pangea/dnd";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { PRIORITY_CONFIG, LABEL_COLORS } from "./index";
import { getSourceBadge } from "./source-utils";

interface DealCardProps {
  deal: any;
  index: number;
  companies: any[];
  assetsById: Record<number, any>;
  onClick: (id: number) => void;
}

export default function DealCard({ deal, index, companies, assetsById, onClick }: DealCardProps) {
  const priority = PRIORITY_CONFIG[deal.priority || "medium"];
  const labels = (deal.labels as string[]) || [];
  const hasDueDate = !!deal.dueDate;
  const isOverdue = hasDueDate && new Date(deal.dueDate!) < new Date();
  const source = getSourceBadge(deal, assetsById);

  return (
    <Draggable key={deal.id} draggableId={String(deal.id)} index={index}>
      {(provided, snapshot) => (
        <Card
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          data-testid={`card-deal-${deal.id}`}
          className={cn(
            "relative cursor-grab border-l-4 border-border/50 hover:border-primary/30 shadow-sm transition-all select-none",
            priority.border,
            snapshot.isDragging && "shadow-2xl ring-2 ring-primary/40 rotate-1 z-50 scale-105 cursor-grabbing"
          )}
          onClick={() => !snapshot.isDragging && onClick(deal.id)}
        >
          <CardContent className="p-3.5 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <h4 className="font-medium text-sm leading-tight line-clamp-2 flex-1">
                {deal.title}
              </h4>
              <GripHorizontal className="w-4 h-4 text-muted-foreground/30 shrink-0 mt-0.5" />
            </div>

            <div className="flex flex-wrap gap-1">
              {source && (
                <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-semibold flex items-center gap-0.5", source.className)} data-testid={`badge-source-${deal.id}`}>
                  <source.icon className="w-2.5 h-2.5" />
                  {source.label}
                </span>
              )}
              {labels.slice(0, 3).map((lbl, i) => (
                <span key={lbl} className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium", LABEL_COLORS[i % LABEL_COLORS.length])}>
                  {lbl}
                </span>
              ))}
              {labels.length > 3 && (
                <span className="text-[10px] text-muted-foreground">+{labels.length - 3}</span>
              )}
            </div>

            {deal.companyId && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Building2 className="w-3 h-3" />
                {(() => {
                  const comp = (companies || []).find(c => c.id === deal.companyId);
                  return comp ? (comp.tradeName || comp.legalName) : `#${deal.companyId}`;
                })()}
              </div>
            )}

            {deal.assetId && assetsById[deal.assetId]?.anmProcesso && (
              <Link href="/anm" className="flex items-center gap-1 text-[10px] text-orange-600 bg-orange-50 dark:bg-orange-900/20 px-1.5 py-0.5 rounded w-fit" data-testid={`badge-anm-deal-${deal.id}`}>
                <Mountain className="w-3 h-3" />
                ANM: <span className="font-mono">{assetsById[deal.assetId].anmProcesso}</span>
              </Link>
            )}

            {deal.assetId && !assetsById[deal.assetId]?.anmProcesso && (() => {
              const attrs = assetsById[deal.assetId!]?.attributesJson as Record<string, any> | null;
              if (!attrs?.carCodImovel) return null;
              return (
                <Link href="/geo-rural" className="flex items-center gap-1 text-[10px] text-green-600 bg-green-50 dark:bg-green-900/20 px-1.5 py-0.5 rounded w-fit" data-testid={`badge-car-deal-${deal.id}`}>
                  <TreePine className="w-3 h-3" />
                  CAR: <span className="font-mono truncate max-w-[120px]">{attrs.carCodImovel}</span>
                </Link>
              );
            })()}

            {deal.description && (
              <p className="text-xs text-muted-foreground line-clamp-1">
                {deal.description.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()}
              </p>
            )}

            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center gap-2">
                {hasDueDate && (
                  <span className={cn("flex items-center gap-0.5 text-[10px]", isOverdue ? "text-red-500" : "text-muted-foreground")}>
                    <Calendar className="w-3 h-3" />
                    {format(new Date(deal.dueDate!), "dd/MM", { locale: ptBR })}
                  </span>
                )}
                <span className={cn("flex items-center gap-0.5 text-[10px] font-medium", {
                  "text-slate-400": deal.priority === "low",
                  "text-blue-500": !deal.priority || deal.priority === "medium",
                  "text-amber-500": deal.priority === "high",
                  "text-red-500": deal.priority === "urgent",
                })}>
                  <Flag className="w-3 h-3" />
                </span>
                {(deal as any).commentCount > 0 && (
                  <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                    <MessageSquare className="w-3 h-3" />
                    {(deal as any).commentCount}
                  </span>
                )}
                {(deal as any).attachmentCount > 0 && (
                  <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                    <Paperclip className="w-3 h-3" />
                    {(deal as any).attachmentCount}
                  </span>
                )}
              </div>
              {deal.amountEstimate ? (
                <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 px-1.5 py-0.5 rounded flex items-center">
                  <DollarSign className="w-3 h-3 mr-0.5" />
                  {deal.amountEstimate >= 1000000
                    ? `${(deal.amountEstimate / 1000000).toFixed(1)}M`
                    : `${(deal.amountEstimate / 1000).toFixed(0)}k`}
                </span>
              ) : null}
            </div>
          </CardContent>
        </Card>
      )}
    </Draggable>
  );
}

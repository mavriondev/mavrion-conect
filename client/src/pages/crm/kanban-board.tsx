import { Badge } from "@/components/ui/badge";
import { Trash2 } from "lucide-react";
import { DragDropContext, Droppable, DropResult } from "@hello-pangea/dnd";
import { cn } from "@/lib/utils";
import DealCard from "./deal-card";
import AddColumnDialog from "./add-column-dialog";

interface KanbanBoardProps {
  stages: any[];
  filteredDeals: any[];
  companies: any[];
  assetsById: Record<number, any>;
  pipelineType: string;
  onDealClick: (id: number) => void;
  onDragEnd: (result: DropResult) => void;
  onDeleteStage: (id: number) => void;
  onStageCreated: () => void;
}

export default function KanbanBoard({
  stages,
  filteredDeals,
  companies,
  assetsById,
  pipelineType,
  onDealClick,
  onDragEnd,
  onDeleteStage,
  onStageCreated,
}: KanbanBoardProps) {
  return (
    <div className="flex-1 overflow-x-auto pb-4 min-h-0">
      <DragDropContext onDragEnd={onDragEnd}>
        <div className="flex h-full gap-4 min-w-max items-start">
          {stages.map((stage) => {
            const stageDeals = filteredDeals.filter(d => d.stageId === stage.id);
            const totalValue = stageDeals.reduce((sum, d) => sum + (d.amountEstimate || 0), 0);

            return (
              <div key={stage.id} className="w-72 flex flex-col shrink-0">
                <div className="mb-3 px-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: stage.color || "#94a3b8" }}
                      />
                      <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide truncate">
                        {stage.name}
                      </h3>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Badge variant="secondary" className="text-xs font-mono shrink-0" data-testid={`badge-stage-count-${stage.id}`}>
                        {stageDeals.length}
                      </Badge>
                      {stageDeals.length === 0 && (
                        <button
                          onClick={() => onDeleteStage(stage.id)}
                          className="text-muted-foreground/40 hover:text-destructive transition-colors"
                          title="Excluir coluna vazia"
                          data-testid={`button-delete-stage-${stage.id}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  {totalValue > 0 && (
                    <p className="text-[10px] text-muted-foreground mt-0.5 font-medium" data-testid={`text-stage-value-${stage.id}`}>
                      R$ {totalValue >= 1000000
                        ? `${(totalValue / 1000000).toFixed(1)}M`
                        : totalValue >= 1000
                          ? `${(totalValue / 1000).toFixed(0)}k`
                          : totalValue.toFixed(0)}
                    </p>
                  )}
                </div>

                <Droppable droppableId={String(stage.id)}>
                  {(provided, snapshot) => (
                    <div
                      {...provided.droppableProps}
                      ref={provided.innerRef}
                      className={cn(
                        "flex-1 rounded-xl p-2 space-y-2.5 transition-colors min-h-[200px] bg-muted/30",
                        snapshot.isDraggingOver && "bg-primary/5 border-2 border-dashed border-primary/30"
                      )}
                    >
                      {stageDeals.map((deal, index) => (
                        <DealCard
                          key={deal.id}
                          deal={deal}
                          index={index}
                          companies={companies}
                          assetsById={assetsById}
                          onClick={onDealClick}
                        />
                      ))}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>

              </div>
            );
          })}

          <div className="shrink-0 mt-8">
            <AddColumnDialog pipelineType={pipelineType} onCreated={onStageCreated} />
          </div>
        </div>
      </DragDropContext>
    </div>
  );
}

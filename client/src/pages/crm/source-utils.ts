import {
  Telescope, Handshake, Target, Pickaxe, TreePine, Pencil
} from "lucide-react";

export interface SourceBadge {
  label: string;
  className: string;
  icon: any;
}

export function getSourceBadge(deal: any, assetsById: Record<number, any> = {}): SourceBadge | null {
  const labels = (deal.labels as string[]) || [];
  const title = (deal.title || "").toLowerCase();

  if (labels.some(l => l.toLowerCase() === "matching") || title.startsWith("match:")) {
    return { label: "Matching", className: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300", icon: Target };
  }
  if (labels.some(l => l.toLowerCase().includes("m&a")) || labels.some(l => l.toLowerCase() === "ma") || title.includes("m&a")) {
    return { label: "M&A", className: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300", icon: Handshake };
  }
  if (deal.assetId && assetsById[deal.assetId]?.anmProcesso) {
    return { label: "ANM", className: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300", icon: Pickaxe };
  }
  if (deal.assetId) {
    const attrs = assetsById[deal.assetId]?.attributesJson as Record<string, any> | null;
    if (attrs?.carCodImovel) {
      return { label: "SICAR", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300", icon: TreePine };
    }
  }
  if (labels.some(l => l.toLowerCase().includes("prospecção")) || labels.some(l => l.toLowerCase() === "cnpja")) {
    return { label: "Prospecção", className: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300", icon: Telescope };
  }
  return { label: "Manual", className: "bg-gray-100 text-gray-600 dark:bg-gray-800/50 dark:text-gray-400", icon: Pencil };
}

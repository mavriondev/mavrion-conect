import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type InsertAsset, type InsertInvestorProfile } from "@shared/routes";
import { useToast } from "./use-toast";
import { apiRequest } from "@/lib/queryClient";

export function useAssets() {
  return useQuery({
    queryKey: [api.matching.assets.list.path],
    queryFn: async () => {
      const res = await fetch(api.matching.assets.list.path);
      if (!res.ok) throw new Error("Failed to fetch assets");
      return api.matching.assets.list.responses[200].parse(await res.json());
    },
  });
}

export function useInvestors() {
  return useQuery({
    queryKey: [api.matching.investors.list.path],
    queryFn: async () => {
      const res = await fetch(api.matching.investors.list.path);
      if (!res.ok) throw new Error("Failed to fetch investors");
      return api.matching.investors.list.responses[200].parse(await res.json());
    },
  });
}

export function useSuggestions() {
  return useQuery({
    queryKey: [api.matching.suggestions.list.path],
    queryFn: async () => {
      const res = await fetch(api.matching.suggestions.list.path);
      if (!res.ok) throw new Error("Failed to fetch suggestions");
      return api.matching.suggestions.list.responses[200].parse(await res.json());
    },
  });
}

export function useRunMatching() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", api.matching.suggestions.run.path);
      const json = await res.json();
      return api.matching.suggestions.run.responses[200].parse(json);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [api.matching.suggestions.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.matching.assets.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.matching.investors.list.path] });
      const d = data.details;
      if (data.matchesFound > 0) {
        toast({
          title: "Matching concluído!",
          description: `${data.matchesFound} novo(s) match(es) encontrado(s). Avaliados: ${d?.pairsEvaluated ?? "?"} pares.`,
        });
      } else {
        const parts: string[] = [];
        if (d?.totalAssets === 0) parts.push("Nenhum ativo cadastrado");
        if ((d?.totalInvestors ?? 0) === 0 && (d?.totalCompanies ?? 0) === 0) parts.push("Nenhum investidor/empresa cadastrado");
        if (parts.length === 0) parts.push(`${d?.pairsEvaluated ?? 0} pares avaliados, nenhum atingiu o score mínimo`);
        toast({
          title: "Matching concluído — 0 novos matches",
          description: parts.join(". ") + ".",
        });
      }
    },
    onError: (err: any) => {
      toast({
        title: "Erro ao executar matching",
        description: err.message || "Erro desconhecido",
        variant: "destructive",
      });
    },
  });
}

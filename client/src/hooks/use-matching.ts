import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type InsertAsset, type InsertInvestorProfile } from "@shared/routes";
import { useToast } from "./use-toast";

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
      const res = await fetch(api.matching.suggestions.run.path, { method: "POST" });
      if (!res.ok) throw new Error("Failed to run matching");
      return api.matching.suggestions.run.responses[200].parse(await res.json());
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [api.matching.suggestions.list.path] });
      toast({ 
        title: "Matching Complete", 
        description: `Found ${data.matchesFound} new potential matches.` 
      });
    },
  });
}

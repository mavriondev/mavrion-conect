import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl, type InsertCompany, type InsertDeal } from "@shared/routes";
import { useToast } from "./use-toast";

export function useDeals(pipelineType?: string) {
  return useQuery({
    queryKey: [api.crm.deals.list.path, pipelineType],
    queryFn: async () => {
      const url = pipelineType 
        ? `${api.crm.deals.list.path}?pipelineType=${pipelineType}`
        : api.crm.deals.list.path;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch deals");
      return api.crm.deals.list.responses[200].parse(await res.json());
    },
  });
}

export function useCreateDeal() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: InsertDeal) => {
      const res = await fetch(api.crm.deals.create.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create deal");
      return api.crm.deals.create.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.crm.deals.list.path] });
      toast({ title: "Success", description: "Deal created successfully" });
    },
  });
}

export function useUpdateDeal() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, ...data }: { id: number } & Partial<InsertDeal>) => {
      const url = buildUrl(api.crm.deals.update.path, { id });
      const res = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update deal");
      return api.crm.deals.update.responses[200].parse(await res.json());
    },
    onMutate: async ({ id, ...data }) => {
      const queries = queryClient.getQueriesData<any[]>({ queryKey: [api.crm.deals.list.path] });
      const snapshots = queries.map(([key, val]) => [key, val] as const);
      for (const [key] of queries) {
        queryClient.setQueryData(key, (old: any[] | undefined) =>
          old?.map((deal: any) => deal.id === id ? { ...deal, ...data } : deal)
        );
      }
      await queryClient.cancelQueries({ queryKey: [api.crm.deals.list.path] });
      return { snapshots };
    },
    onError: (_err, _vars, context) => {
      if (context?.snapshots) {
        for (const [key, val] of context.snapshots) {
          queryClient.setQueryData(key, val);
        }
      }
      toast({ title: "Erro ao mover deal", variant: "destructive" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [api.crm.deals.list.path] });
    },
  });
}

export function useCompanies() {
  return useQuery({
    queryKey: [api.crm.companies.list.path],
    queryFn: async () => {
      const res = await fetch(api.crm.companies.list.path);
      if (!res.ok) throw new Error("Failed to fetch companies");
      return api.crm.companies.list.responses[200].parse(await res.json());
    },
  });
}

export function useStages() {
  return useQuery({
    queryKey: [api.crm.stages.list.path],
    queryFn: async () => {
      const res = await fetch(api.crm.stages.list.path);
      if (!res.ok) throw new Error("Failed to fetch stages");
      return api.crm.stages.list.responses[200].parse(await res.json());
    },
  });
}

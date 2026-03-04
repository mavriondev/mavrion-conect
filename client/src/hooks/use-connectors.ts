import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl, type InsertConnector } from "@shared/routes";
import { useToast } from "./use-toast";

export function useConnectors() {
  return useQuery({
    queryKey: [api.connectors.list.path],
    queryFn: async () => {
      const res = await fetch(api.connectors.list.path);
      if (!res.ok) throw new Error("Failed to fetch connectors");
      return api.connectors.list.responses[200].parse(await res.json());
    },
  });
}

export function useCreateConnector() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: InsertConnector) => {
      const res = await fetch(api.connectors.create.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create connector");
      return api.connectors.create.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.connectors.list.path] });
      toast({ title: "Success", description: "Connector created" });
    },
  });
}

export function useRunConnector() {
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: number) => {
      const url = buildUrl(api.connectors.run.path, { id });
      const res = await fetch(url, { method: "POST" });
      if (!res.ok) throw new Error("Failed to run connector");
      return api.connectors.run.responses[200].parse(await res.json());
    },
    onSuccess: () => {
      toast({ title: "Job Started", description: "Connector is running in background" });
    },
  });
}

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { useToast } from "./use-toast";

export function useLeads() {
  return useQuery({
    queryKey: [api.sdr.queue.path],
    queryFn: async () => {
      const res = await fetch(api.sdr.queue.path);
      if (!res.ok) throw new Error("Failed to fetch leads");
      return api.sdr.queue.responses[200].parse(await res.json());
    },
  });
}

export function useUpdateLead() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const url = buildUrl(api.sdr.updateLead.path, { id });
      const res = await fetch(url, {
        method: api.sdr.updateLead.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Failed to update lead");
      return api.sdr.updateLead.responses[200].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.sdr.queue.path] });
      toast({ title: "Lead updated", description: "Status changed successfully" });
    },
  });
}

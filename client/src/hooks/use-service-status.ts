import { useQuery } from "@tanstack/react-query";

interface ServiceStatus {
  anm: "online" | "offline";
  sicar: "online" | "offline";
  checkedAt: string;
}

export function useServiceStatus() {
  return useQuery<ServiceStatus>({
    queryKey: ["/api/health/services"],
    refetchInterval: 60000,
    staleTime: 30000,
    retry: 1,
  });
}

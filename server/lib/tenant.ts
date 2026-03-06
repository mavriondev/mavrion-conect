const DEFAULT_ORG_ID = Number(process.env.DEFAULT_ORG_ID) || 1;

export function getOrgId(req?: any): number {
  if (req && req.user && (req.user as any).orgId) {
    return (req.user as any).orgId;
  }
  return DEFAULT_ORG_ID;
}

export function stripOrgId<T extends Record<string, any>>(body: T): Omit<T, "orgId"> {
  const { orgId, ...rest } = body;
  return rest as Omit<T, "orgId">;
}

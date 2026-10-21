import { useState, useMemo, useCallback } from "react";

export type SortDirection = "asc" | "desc";

export interface SortState {
  column: string | null;
  direction: SortDirection;
}

export function useTableSort<T>(data: T[], defaultColumn?: string, defaultDirection: SortDirection = "asc") {
  const [sort, setSort] = useState<SortState>({
    column: defaultColumn || null,
    direction: defaultDirection,
  });

  const toggleSort = useCallback((column: string) => {
    setSort(prev => {
      if (prev.column === column) {
        return { column, direction: prev.direction === "asc" ? "desc" : "asc" };
      }
      return { column, direction: "asc" };
    });
  }, []);

  const sortedData = useMemo(() => {
    if (!sort.column) return data;
    const col = sort.column;
    const dir = sort.direction === "asc" ? 1 : -1;

    return [...data].sort((a: any, b: any) => {
      let valA = a[col];
      let valB = b[col];

      if (valA == null && valB == null) return 0;
      if (valA == null) return 1;
      if (valB == null) return -1;

      if (typeof valA === "number" && typeof valB === "number") {
        return (valA - valB) * dir;
      }

      const numA = Number(valA);
      const numB = Number(valB);
      if (!isNaN(numA) && !isNaN(numB) && valA !== "" && valB !== "") {
        return (numA - numB) * dir;
      }

      const strA = String(valA).toLowerCase();
      const strB = String(valB).toLowerCase();
      return strA.localeCompare(strB, "pt-BR") * dir;
    });
  }, [data, sort.column, sort.direction]);

  return { sort, toggleSort, sortedData };
}

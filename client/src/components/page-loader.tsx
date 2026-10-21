import { Suspense, type ReactNode } from "react";

// Errors continue to use the existing GlobalErrorBoundary and its reload action.
export function PageLoader({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={
      <div role="status" className="flex min-h-48 items-center justify-center gap-3 p-6">
        <div aria-hidden="true" className="h-6 w-6 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <span>Carregando tela…</span>
      </div>
    }>
      {children}
    </Suspense>
  );
}

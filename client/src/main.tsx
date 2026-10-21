import { createRoot } from "react-dom/client";
import { Component, type ReactNode } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import App from "./App";
import "./index.css";

const TRANSIENT_PATTERNS = [
  "parentNode",
  "removeChild",
  "insertBefore",
  "NotFoundError",
];

function isTransientDomError(error: Error): boolean {
  const msg = error.message || "";
  return TRANSIENT_PATTERNS.some(p => msg.includes(p));
}

interface EBProps { children: ReactNode }
interface EBState { hasError: boolean; error?: Error; retryCount: number }

class GlobalErrorBoundary extends Component<EBProps, EBState> {
  constructor(props: EBProps) {
    super(props);
    this.state = { hasError: false, retryCount: 0 };
  }
  static getDerivedStateFromError(error: Error): Partial<EBState> {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, info: any) {
    if (isTransientDomError(error) && this.state.retryCount < 5) {
      setTimeout(() => {
        this.setState(prev => ({ hasError: false, error: undefined, retryCount: prev.retryCount + 1 }));
      }, 50);
      return;
    }
    console.error("[GlobalErrorBoundary]", error, info?.componentStack);
  }
  render() {
    if (this.state.hasError) {
      if (isTransientDomError(this.state.error!) && this.state.retryCount < 5) {
        return null;
      }
      return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", padding: "2rem", textAlign: "center", fontFamily: "system-ui, sans-serif" }}>
          <AlertCircle style={{ width: 48, height: 48, color: "#ef4444", marginBottom: 16 }} />
          <h1 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: 8 }}>Ocorreu um erro inesperado</h1>
          <p style={{ color: "#6b7280", fontSize: "0.875rem", marginBottom: 16, maxWidth: 400 }}>
            {this.state.error?.message || "A aplicação encontrou um problema. Tente recarregar a página."}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", fontSize: "0.875rem", borderRadius: 6, border: "1px solid #d1d5db", background: "#fff", cursor: "pointer" }}
            data-testid="button-reload-app"
          >
            <RefreshCw style={{ width: 14, height: 14 }} />
            Recarregar página
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <GlobalErrorBoundary>
    <App />
  </GlobalErrorBoundary>
);

import { Component, type ReactNode } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  fallbackMessage?: string;
  resetKey?: string;
}

interface State {
  hasError: boolean;
  error?: Error;
  retryCount: number;
}

const TRANSIENT_PATTERNS = [
  "parentNode",
  "removeChild",
  "insertBefore",
  "Cannot read properties of undefined",
  "Cannot read properties of null",
  "NotFoundError",
];

function isTransientDomError(error: Error): boolean {
  const msg = error.message || "";
  return TRANSIENT_PATTERNS.some(p => msg.includes(p));
}

export class TabErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, retryCount: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidUpdate(prevProps: Props) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false, error: undefined, retryCount: 0 });
    }
  }

  componentDidCatch(error: Error, info: any) {
    if (isTransientDomError(error) && this.state.retryCount < 3) {
      setTimeout(() => {
        this.setState(prev => ({ hasError: false, error: undefined, retryCount: prev.retryCount + 1 }));
      }, 50);
      return;
    }
    console.error("[TabErrorBoundary]", error, info?.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center py-12 px-4 text-center" data-testid="tab-error-boundary">
          <AlertCircle className="w-10 h-10 text-red-400 mb-3" />
          <p className="text-sm font-medium text-foreground mb-1">
            {this.props.fallbackMessage || "Erro ao carregar esta seção"}
          </p>
          <p className="text-xs text-muted-foreground mb-4 max-w-md">
            {this.state.error?.message || "Ocorreu um erro inesperado."}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: undefined, retryCount: 0 })}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-border bg-background hover:bg-muted transition-colors"
            data-testid="button-retry-tab"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Tentar novamente
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

import { useEffect, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";

const DEBOUNCE_MS = 5000;
const recentErrors = new Map<string, number>();

function shouldReport(key: string): boolean {
  const now = Date.now();
  const last = recentErrors.get(key);
  if (last && now - last < DEBOUNCE_MS) return false;
  recentErrors.set(key, now);
  if (recentErrors.size > 100) {
    const oldest = [...recentErrors.entries()].sort((a, b) => a[1] - b[1])[0];
    if (oldest) recentErrors.delete(oldest[0]);
  }
  return true;
}

async function sendAutoReport(data: {
  url?: string;
  method?: string;
  statusCode?: number;
  errorMessage?: string;
  stack?: string;
  page?: string;
}) {
  try {
    await fetch("/api/error-reports/auto", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(data),
    });
  } catch {
  }
}

export function useErrorCapture() {
  const { user } = useAuth();
  const initialized = useRef(false);

  useEffect(() => {
    if (!user || initialized.current) return;
    initialized.current = true;

    const originalFetch = window.fetch;
    window.fetch = async function (...args: Parameters<typeof fetch>) {
      const [input, init] = args;
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
      const method = init?.method || "GET";

      if (url.includes("/api/error-reports")) {
        return originalFetch.apply(this, args);
      }

      try {
        const response = await originalFetch.apply(this, args);

        if (url.startsWith("/api/")) {
          if (response.status >= 400) {
            const key = `${method}:${url}:${response.status}`;
            if (shouldReport(key)) {
              let errorText = "";
              try {
                const clone = response.clone();
                errorText = await clone.text();
              } catch {}
              sendAutoReport({
                url,
                method,
                statusCode: response.status,
                errorMessage: errorText?.substring(0, 500) || `HTTP ${response.status}`,
                page: window.location.pathname,
              });
            }
          } else if (response.status === 200) {
            try {
              const clone = response.clone();
              const text = await clone.text();
              const isHtml = text.trimStart().startsWith("<!") || text.trimStart().startsWith("<html");
              let isFalseSuccess = false;
              try {
                const parsed = JSON.parse(text);
                if (parsed && (parsed.success === false || (parsed.error && typeof parsed.error === "string"))) {
                  isFalseSuccess = true;
                }
              } catch {}
              if (isHtml || isFalseSuccess) {
                const key = `masked:${method}:${url}`;
                if (shouldReport(key)) {
                  sendAutoReport({
                    url,
                    method,
                    statusCode: 200,
                    errorMessage: isHtml
                      ? "HTTP 200 retornou HTML em vez de JSON (possível SPA fallback)"
                      : "HTTP 200 com {success:false} ou {error:...}",
                    page: window.location.pathname,
                  });
                }
              }
            } catch {}
          }
        }

        return response;
      } catch (err: any) {
        const key = `${method}:${url}:network`;
        if (shouldReport(key)) {
          sendAutoReport({
            url,
            method,
            errorMessage: err?.message || "Network error",
            stack: err?.stack?.substring(0, 1000),
            page: window.location.pathname,
          });
        }
        throw err;
      }
    };

    const handleError = (event: ErrorEvent) => {
      const key = `error:${event.message}`;
      if (shouldReport(key)) {
        sendAutoReport({
          errorMessage: event.message,
          stack: event.error?.stack?.substring(0, 1000),
          page: window.location.pathname,
        });
      }
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
      const msg = event.reason?.message || String(event.reason);
      const key = `rejection:${msg}`;
      if (shouldReport(key)) {
        sendAutoReport({
          errorMessage: `Unhandled Promise Rejection: ${msg}`,
          stack: event.reason?.stack?.substring(0, 1000),
          page: window.location.pathname,
        });
      }
    };

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);

    return () => {
      window.fetch = originalFetch;
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
      initialized.current = false;
    };
  }, [user]);
}

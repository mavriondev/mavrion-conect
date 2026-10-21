// Busca dos nomes dos detentores das parcelas SIGEF via Consulta Pública do
// SNCR (sncr.serpro.gov.br). O download oficial exige um hCaptcha — embedamos
// o widget aqui: o usuário resolve o captcha, o servidor baixa o CSV do
// município e grava em cache (banco). Cada município só precisa de captcha
// uma única vez; depois disso os detentores preenchem automaticamente.
import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ExternalLink, Users } from "lucide-react";

declare global {
  interface Window {
    hcaptcha?: {
      render: (el: HTMLElement, opts: Record<string, any>) => string;
      reset: (id?: string) => void;
      remove: (id?: string) => void;
    };
  }
}

let hcaptchaScriptPromise: Promise<void> | null = null;
function carregarHcaptchaScript(): Promise<void> {
  if (window.hcaptcha) return Promise.resolve();
  if (hcaptchaScriptPromise) return hcaptchaScriptPromise;
  hcaptchaScriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://js.hcaptcha.com/1/api.js?render=explicit";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { hcaptchaScriptPromise = null; reject(new Error("Falha ao carregar o hCaptcha")); };
    document.head.appendChild(s);
  });
  return hcaptchaScriptPromise;
}

interface MunicipioPendente { ufIbge: string; municipioIbge: number; nome: string | null }

export function SigefDetentoresDialog({
  ativoId, open, onOpenChange,
}: { ativoId: number; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const captchaRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [sessao, setSessao] = useState<{ sessionId: string; sitekey: string } | null>(null);
  const [pendentes, setPendentes] = useState<MunicipioPendente[] | null>(null);
  const [captchaErro, setCaptchaErro] = useState<string | null>(null);
  const [modoManual, setModoManual] = useState(false);
  const [csvTexto, setCsvTexto] = useState("");
  const [baixando, setBaixando] = useState(false);

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/assets", String(ativoId)] });
    queryClient.invalidateQueries({ queryKey: ["/api/assets", ativoId] });
  };

  // Passo 1 (ao abrir): preenche do cache e descobre municípios pendentes + abre sessão SNCR
  const iniciarMutation = useMutation({
    mutationFn: async () => {
      const [detRes, sesRes] = await Promise.all([
        apiRequest("POST", `/api/assets/${ativoId}/sigef-detentores`, {}),
        apiRequest("POST", "/api/sncr/sessao").catch(() => null),
      ]);
      const det = await detRes.json();
      const ses = sesRes ? await sesRes.json().catch(() => null) : null;
      return { det, ses };
    },
    onSuccess: ({ det, ses }) => {
      setPendentes(det.municipiosPendentes || []);
      if (ses?.sessionId) setSessao(ses);
      else if ((det.municipiosPendentes || []).length > 0) {
        setCaptchaErro("Não foi possível abrir a sessão no SNCR — use o envio manual abaixo");
        setModoManual(true);
      }
      if (det.preenchidas > 0) {
        invalidar();
        toast({ title: "Detentores preenchidos", description: `${det.preenchidas} parcela(s) preenchida(s) do cache` });
      }
      if ((det.municipiosPendentes || []).length === 0) onOpenChange(false);
    },
    onError: (e: any) => {
      toast({ title: "Falha ao preparar busca", description: e?.message || "Erro", variant: "destructive" });
      onOpenChange(false);
    },
  });

  // Passo 2: com o token do captcha, baixa o CSV de um município pendente
  const baixarComToken = async (token: string) => {
    setBaixando(true);
    try {
      const res = await apiRequest("POST", `/api/assets/${ativoId}/sigef-detentores`, {
        sessionId: sessao?.sessionId, captchaToken: token,
      });
      const data = await res.json();
      setPendentes(data.municipiosPendentes || []);
      invalidar();
      if ((data.municipiosPendentes || []).length === 0) {
        toast({
          title: "Detentores preenchidos",
          description: data.totalComDetentor > 0
            ? `${data.totalComDetentor} parcela(s) com detentor identificado`
            : "Município baixado, mas os imóveis das parcelas não constam no SNCR",
        });
        onOpenChange(false);
      } else {
        toast({
          title: `Município ${data.municipioBaixado || ""} baixado`,
          description: `Falta(m) ${data.municipiosPendentes.length} município(s) — resolva o captcha novamente`,
        });
        try { window.hcaptcha?.reset(widgetIdRef.current || undefined); } catch {}
      }
    } catch (e: any) {
      const msg = e?.message || "Erro ao baixar do SNCR";
      toast({ title: "Falha na busca", description: msg, variant: "destructive" });
      try { window.hcaptcha?.reset(widgetIdRef.current || undefined); } catch {}
      if (/captcha/i.test(msg)) setCaptchaErro(null);
      else setModoManual(true);
    } finally {
      setBaixando(false);
    }
  };

  // Fallback: usuário cola o conteúdo do CSV baixado manualmente no site
  const csvMutation = useMutation({
    mutationFn: async () => {
      const alvo = pendentes?.[0];
      const res = await apiRequest("POST", `/api/assets/${ativoId}/sigef-detentores/csv`, {
        csv: csvTexto,
        ufIbge: alvo?.ufIbge,
        municipioIbge: alvo?.municipioIbge,
      });
      return await res.json();
    },
    onSuccess: (data: any) => {
      setPendentes(data.municipiosPendentes || []);
      setCsvTexto("");
      invalidar();
      toast({
        title: "CSV processado",
        description: `${data.totalComDetentor} parcela(s) com detentor identificado`,
      });
      if ((data.municipiosPendentes || []).length === 0) onOpenChange(false);
    },
    onError: (e: any) => {
      toast({ title: "CSV inválido", description: e?.message || "Erro ao processar", variant: "destructive" });
    },
  });

  useEffect(() => {
    if (open) {
      setSessao(null); setPendentes(null); setCaptchaErro(null);
      setModoManual(false); setCsvTexto("");
      widgetIdRef.current = null;
      iniciarMutation.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Renderiza o widget do hCaptcha quando há sessão + municípios pendentes
  useEffect(() => {
    if (!open || !sessao || !pendentes || pendentes.length === 0 || modoManual) return;
    let cancelado = false;
    (async () => {
      try {
        await carregarHcaptchaScript();
        if (cancelado || !captchaRef.current || !window.hcaptcha) return;
        captchaRef.current.innerHTML = "";
        widgetIdRef.current = window.hcaptcha.render(captchaRef.current, {
          sitekey: sessao.sitekey,
          callback: (token: string) => { void baixarComToken(token); },
          "error-callback": () => {
            setCaptchaErro("O captcha do SNCR não carregou neste domínio — use o envio manual abaixo");
            setModoManual(true);
          },
          "expired-callback": () => { try { window.hcaptcha?.reset(widgetIdRef.current || undefined); } catch {} },
        });
      } catch {
        if (!cancelado) {
          setCaptchaErro("Não foi possível carregar o hCaptcha — use o envio manual abaixo");
          setModoManual(true);
        }
      }
    })();
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sessao, pendentes, modoManual]);

  const alvo = pendentes?.[0];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="dialog-sigef-detentores">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Users className="w-4 h-4" /> Buscar detentores (SNCR/INCRA)
          </DialogTitle>
          <DialogDescription className="text-xs">
            Os nomes dos detentores vêm do CSV oficial da Consulta Pública do SNCR, cruzados pelo
            código do imóvel. O download exige um captcha — resolva abaixo; cada município só
            precisa disso uma vez (fica em cache para todos os ativos).
          </DialogDescription>
        </DialogHeader>

        {iniciarMutation.isPending && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Verificando cache e abrindo sessão no SNCR...
          </div>
        )}

        {!iniciarMutation.isPending && pendentes && pendentes.length > 0 && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">Município(s) pendente(s):</span>
              {pendentes.map((m) => (
                <Badge key={`${m.ufIbge}-${m.municipioIbge}`} variant="outline">
                  {m.nome || `IBGE ${m.municipioIbge}`}
                </Badge>
              ))}
            </div>

            {baixando ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center" data-testid="text-sncr-baixando">
                <Loader2 className="w-4 h-4 animate-spin" /> Baixando CSV do SNCR e cruzando os imóveis...
              </div>
            ) : !modoManual ? (
              <div className="flex justify-center py-2">
                <div ref={captchaRef} data-testid="captcha-sncr" />
              </div>
            ) : null}

            {captchaErro && (
              <p className="text-xs text-amber-700 dark:text-amber-300" data-testid="text-captcha-erro">{captchaErro}</p>
            )}

            {!modoManual ? (
              <button type="button" className="text-[11px] text-muted-foreground underline"
                onClick={() => setModoManual(true)} data-testid="button-modo-manual">
                Captcha não carregou? Enviar CSV manualmente
              </button>
            ) : (
              <div className="space-y-2 border-t pt-3">
                <p className="text-xs text-muted-foreground">
                  1. Abra a{" "}
                  <a href="https://sncr.serpro.gov.br/sncr-web/consultaPublica.jsf" target="_blank" rel="noreferrer"
                    className="underline inline-flex items-center gap-0.5">
                    Consulta Pública do SNCR <ExternalLink className="w-3 h-3" />
                  </a>{" "}
                  2. Selecione <strong>{alvo?.nome || "o município"}</strong>, resolva o captcha e baixe o CSV.{" "}
                  3. Cole o conteúdo do arquivo aqui:
                </p>
                <Textarea rows={5} value={csvTexto} onChange={(e) => setCsvTexto(e.target.value)}
                  placeholder="Cole aqui o conteúdo do CSV baixado do SNCR..."
                  className="text-xs font-mono" data-testid="input-csv-sncr" />
                <div className="flex gap-2">
                  <Button size="sm" disabled={!csvTexto.trim() || csvMutation.isPending}
                    onClick={() => csvMutation.mutate()} data-testid="button-enviar-csv">
                    {csvMutation.isPending ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> Processando...</> : "Processar CSV"}
                  </Button>
                  {sessao && (
                    <Button size="sm" variant="ghost" onClick={() => { setModoManual(false); setCaptchaErro(null); }}>
                      Voltar ao captcha
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

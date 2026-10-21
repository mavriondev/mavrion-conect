import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const NAVY = "#1a365d";

const DOC_STYLES = `
  * { box-sizing: border-box; }
  .doc-page {
    width: 794px; background: #fff; padding: 64px 56px 72px;
    font-family: 'Georgia', 'Times New Roman', serif; color: #1a1a1a;
    line-height: 1.75; font-size: 13px;
  }
  .doc-cover {
    min-height: 500px; display: flex; flex-direction: column;
    align-items: center; justify-content: center; text-align: center;
    border: 2px solid ${NAVY}; padding: 80px 48px; margin-bottom: 48px;
  }
  .doc-cover h1 {
    font-size: 32px; font-weight: 700; color: ${NAVY};
    margin: 0 0 8px; letter-spacing: -0.5px;
  }
  .doc-cover .subtitle {
    font-size: 16px; color: #4a5568; font-style: italic; margin-bottom: 32px;
  }
  .doc-cover .meta {
    font-size: 11px; color: #718096; line-height: 1.8;
  }
  .doc-section { margin-bottom: 36px; page-break-inside: avoid; }
  .doc-section h2 {
    font-size: 19px; font-weight: 700; color: ${NAVY};
    border-bottom: 2px solid ${NAVY}; padding-bottom: 6px;
    margin: 0 0 16px;
  }
  .doc-section h3 {
    font-size: 15px; font-weight: 700; color: #2d3748;
    margin: 20px 0 10px;
  }
  .doc-section p {
    margin: 0 0 12px; text-align: justify;
  }
  .doc-section ul, .doc-section ol {
    margin: 8px 0 14px; padding-left: 24px;
  }
  .doc-section li { margin-bottom: 5px; line-height: 1.7; }
  .doc-section li::marker { color: ${NAVY}; }
  .doc-section strong { font-weight: 700; color: #1a202c; }
  .doc-section em { font-style: italic; color: #4a5568; }
  table.doc-table {
    width: 100%; border-collapse: collapse; margin: 12px 0 20px; font-size: 11.5px;
  }
  table.doc-table th {
    background: #edf2f7; padding: 8px 10px; text-align: left;
    font-weight: 700; border: 1px solid #cbd5e0; color: #2d3748; font-size: 11px;
  }
  table.doc-table td {
    padding: 6px 10px; border: 1px solid #e2e8f0; vertical-align: top;
  }
  table.doc-table tr:nth-child(even) td { background: #f7fafc; }
  .severity-red { color: #c53030; font-weight: 700; }
  .severity-yellow { color: #b7791f; font-weight: 700; }
  .severity-green { color: #276749; font-weight: 700; }
  .flow-box {
    background: #f7fafc; border: 1px solid #e2e8f0; border-radius: 6px;
    padding: 16px 20px; margin: 12px 0 20px; font-family: 'Courier New', monospace;
    font-size: 12px; line-height: 2; color: #2d3748; white-space: pre-wrap;
  }
  .gap-card {
    border-left: 4px solid; padding: 12px 16px; margin: 12px 0;
    background: #f7fafc; border-radius: 0 6px 6px 0;
  }
  .gap-card.red { border-color: #c53030; }
  .gap-card.yellow { border-color: #d69e2e; }
  .gap-card.green { border-color: #38a169; }
  .gap-card .gap-title { font-weight: 700; margin-bottom: 4px; }
  .gap-card p { margin: 4px 0; font-size: 12px; }
`;

const today = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });

function buildDocHtml(): string {
      return `<style>${DOC_STYLES}</style><div class="doc"><h1>Mavrion Connect — Arquitetura</h1><p>Atualizado em ${today}.</p><h2>Módulos ativos</h2><ul><li>Dashboard: indicadores de ativos e empresas.</li><li>Prospecção e empresas: consulta e cadastro de empresas.</li><li>Ativos: cadastro, documentos, mapas e enriquecimento.</li><li>Jazidas: ANM, SCM, SEI, SIGEF, geologia, restrições e pesquisa complementar.</li><li>Relatórios: visão dos cadastros e PDF técnico por ativo.</li><li>Configurações: usuários, conectores e acompanhamento de erros.</li></ul><h2>Fluxo de dados</h2><p>Interface → API autenticada → serviços públicos e Hub API → persistência dos resultados → catálogo de evidências e relatório determinístico.</p><h2>Documentos</h2><p>Arquivos de ativos e empresas são mantidos no armazenamento existente, com controle de acesso por organização.</p><h2>Preservação histórica</h2><p>As definições das tabelas legadas foram mantidas para preservar os dados existentes. Não há migração destrutiva nesta limpeza.</p></div>`;
    }

async function exportPdf() {
  const { default: jsPDF } = await import("jspdf");
  const { default: html2canvas } = await import("html2canvas");

  const container = document.createElement("div");
  container.style.cssText = "position:fixed;top:-9999px;left:-9999px;z-index:-1;";

  const wrapper = document.createElement("div");
  wrapper.innerHTML = buildDocHtml();
  container.appendChild(wrapper);
  document.body.appendChild(container);

  const docPage = wrapper.querySelector(".doc-page") as HTMLElement;
  if (!docPage) { document.body.removeChild(container); return; }

  try {
    const canvas = await html2canvas(docPage, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pdfW = pdf.internal.pageSize.getWidth();
    const pdfH = pdf.internal.pageSize.getHeight();
    const pageHeightPx = (pdfH / pdfW) * canvas.width;
    let yPos = 0;
    let pageNum = 0;

    while (yPos < canvas.height) {
      const sliceH = Math.min(pageHeightPx, canvas.height - yPos);
      const sliceCanvas = document.createElement("canvas");
      sliceCanvas.width = canvas.width;
      sliceCanvas.height = sliceH;
      const ctx = sliceCanvas.getContext("2d")!;
      ctx.drawImage(canvas, 0, yPos, sliceCanvas.width, sliceH, 0, 0, sliceCanvas.width, sliceH);
      if (pageNum > 0) pdf.addPage();
      const sliceHeightMm = (sliceH / sliceCanvas.width) * pdfW;
      pdf.addImage(sliceCanvas.toDataURL("image/png"), "PNG", 0, 0, pdfW, sliceHeightMm);

      pdf.setFontSize(7.5);
      pdf.setTextColor(160, 160, 160);
      pdf.setDrawColor(220, 220, 220);
      pdf.line(15, pdfH - 12, pdfW - 15, pdfH - 12);
      pdf.text("Mavrion Connect — Documento de Arquitetura", 15, pdfH - 7);
      pdf.text(`Página ${pageNum + 1}`, pdfW / 2, pdfH - 7, { align: "center" });
      pdf.text(today, pdfW - 15, pdfH - 7, { align: "right" });

      yPos += pageHeightPx;
      pageNum++;
    }

    pdf.save("Mavrion_Conect_Arquitetura.pdf");
  } finally {
    document.body.removeChild(container);
  }
}


export default function ArquiteturaPage() {
  const { toast } = useToast();
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportPdf();
      toast({ title: "PDF gerado com sucesso", description: "O download deve iniciar automaticamente." });
    } catch (err) {
      toast({ title: "Erro ao gerar PDF", description: String(err), variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-arquitetura-title">Documento de Arquitetura</h1>
          <p className="text-sm text-muted-foreground">Mapa completo de conexões entre módulos do Mavrion Connect</p>
        </div>
        <Button onClick={handleExport} disabled={exporting} data-testid="btn-export-pdf">
          {exporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
          {exporting ? "Gerando PDF..." : "Exportar PDF"}
        </Button>
      </div>

      <div className="bg-white rounded-xl border shadow-sm overflow-auto">
        <div
          className="mx-auto"
          style={{ maxWidth: 794 }}
          dangerouslySetInnerHTML={{ __html: buildDocHtml() }}
        />
      </div>
    </div>
  );
}

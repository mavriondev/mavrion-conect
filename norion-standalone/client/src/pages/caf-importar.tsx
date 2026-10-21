import { useState, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Upload, Download } from "lucide-react";

const headerMap: Record<string, string> = {
  "NOME": "nomeTitular", "nome": "nomeTitular", "Nome": "nomeTitular", "nome_titular": "nomeTitular",
  "CPF": "cpfTitular", "cpf": "cpfTitular", "cpf_titular": "cpfTitular",
  "CAF": "numeroCAF", "caf": "numeroCAF", "numero_caf": "numeroCAF", "NUMERO_CAF": "numeroCAF",
  "DAP": "numeroDAPAntigo", "dap": "numeroDAPAntigo", "numero_dap": "numeroDAPAntigo",
  "GRUPO": "grupo", "grupo": "grupo",
  "VALIDADE": "validade", "validade": "validade",
  "MUNICIPIO": "municipio", "municipio": "municipio", "Municipio": "municipio",
  "UF": "uf", "uf": "uf",
  "AREA": "areaHa", "area": "areaHa", "area_ha": "areaHa",
  "ATIVIDADES": "atividadesProdutivas", "atividades": "atividadesProdutivas",
  "RENDA": "rendaBrutaAnual", "renda": "rendaBrutaAnual", "renda_bruta": "rendaBrutaAnual",
};

function mapRow(row: Record<string, string>): Record<string, string> {
  const mapped: Record<string, string> = {};
  Object.entries(row).forEach(([key, val]) => {
    const mappedKey = headerMap[key] || key;
    mapped[mappedKey] = val;
  });
  return mapped;
}

export default function CafImportarPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [csvData, setCsvData] = useState<any[]>([]);
  const [fileName, setFileName] = useState("");

  const importMutation = useMutation({
    mutationFn: async (registros: any[]) => {
      const res = await apiRequest("POST", "/api/norion/caf/importar-csv", { registros });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/norion/caf"] });
      queryClient.invalidateQueries({ queryKey: ["/api/caf-extrator/registros"] });
      toast({ title: `${data.importados} registros importados` });
      setLocation("/caf");
    },
    onError: (err: any) => toast({ title: "Erro na importação", description: err.message, variant: "destructive" }),
  });

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split("\n").filter(l => l.trim());
      if (lines.length < 2) { toast({ title: "Arquivo vazio ou inválido", variant: "destructive" }); return; }
      const headers = lines[0].split(";").map(h => h.trim().replace(/"/g, ""));
      const rows = lines.slice(1).map(line => {
        const cols = line.split(";").map(c => c.trim().replace(/"/g, ""));
        const obj: Record<string, string> = {};
        headers.forEach((h, i) => { obj[h] = cols[i] || ""; });
        return obj;
      });
      setCsvData(rows);
    };
    reader.readAsText(file, "utf-8");
  }

  return (
    <div className="p-6 space-y-6 max-w-[1000px] mx-auto">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => setLocation("/caf")} data-testid="button-voltar-caf">
          <ArrowLeft className="w-4 h-4 mr-1" /> Voltar
        </Button>
        <div className="p-2 bg-green-100 rounded-lg">
          <Upload className="w-6 h-6 text-green-700" />
        </div>
        <div>
          <h1 className="text-2xl font-bold" data-testid="title-caf-importar">Importar CSV</h1>
          <p className="text-sm text-muted-foreground">Importe registros CAF/DAP em lote a partir de arquivo CSV</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Selecionar Arquivo</CardTitle>
          <p className="text-xs text-muted-foreground">
            Separador: ponto-e-vírgula. Colunas aceitas: NOME, CPF, CAF, DAP, GRUPO, VALIDADE, MUNICIPIO, UF, AREA, ATIVIDADES, RENDA.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => fileInputRef.current?.click()} data-testid="button-selecionar-csv">
              <Upload className="w-4 h-4 mr-1" /> Selecionar Arquivo
            </Button>
            <input ref={fileInputRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFileSelect} />
            {fileName && <span className="text-sm text-muted-foreground">{fileName}</span>}
          </div>

          {csvData.length > 0 && (
            <>
              <div className="text-sm font-medium">{csvData.length} registros encontrados</div>
              <div className="max-h-[400px] overflow-auto border rounded">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      {Object.keys(csvData[0]).slice(0, 6).map(k => <TableHead key={k} className="text-xs">{k}</TableHead>)}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {csvData.slice(0, 10).map((row, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs">{i + 1}</TableCell>
                        {Object.values(row).slice(0, 6).map((v: any, j) => (
                          <TableCell key={j} className="text-xs">{v}</TableCell>
                        ))}
                      </TableRow>
                    ))}
                    {csvData.length > 10 && (
                      <TableRow><TableCell colSpan={7} className="text-center text-xs text-muted-foreground">... e mais {csvData.length - 10} registros</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              <div className="flex gap-2">
                <Button variant="outline" onClick={() => { setCsvData([]); setFileName(""); }}>Limpar</Button>
                <Button
                  onClick={() => importMutation.mutate(csvData.map(mapRow))}
                  disabled={importMutation.isPending}
                  data-testid="button-confirmar-import"
                >
                  <Download className="w-4 h-4 mr-1" /> Importar {csvData.length} Registros
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

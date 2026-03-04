import * as XLSX from "xlsx";

export interface ExportColumn {
  header: string;
  key: string;
  format?: (val: any, row: any) => string;
}

function sanitizeCell(val: any): string {
  const s = String(val ?? "");
  if (s.length > 0 && /^[=+\-@\t\r]/.test(s)) {
    return "'" + s;
  }
  return s;
}

export function generateXLSX(data: Record<string, any>[], columns: ExportColumn[]): Buffer {
  const rows = data.map(item =>
    Object.fromEntries(columns.map(col => [
      col.header,
      sanitizeCell(col.format ? col.format(item[col.key], item) : (item[col.key] ?? ""))
    ]))
  );

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);

  const maxWidths = columns.map(col => ({
    wch: Math.min(60, Math.max(col.header.length, ...data.map(d => {
      const val = col.format ? col.format(d[col.key], d) : String(d[col.key] ?? "");
      return String(val).length;
    })) + 2)
  }));
  ws["!cols"] = maxWidths;

  XLSX.utils.book_append_sheet(wb, ws, "Dados");
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

export function generateCSV(data: Record<string, any>[], columns: ExportColumn[]): string {
  const headers = columns.map(c => `"${c.header}"`).join(";");
  const rows = data.map(item =>
    columns.map(col => {
      const val = sanitizeCell(col.format ? col.format(item[col.key], item) : (item[col.key] ?? ""));
      return `"${String(val).replace(/"/g, '""')}"`;
    }).join(";")
  );
  return "\uFEFF" + [headers, ...rows].join("\n");
}

export function sendExport(res: any, data: Record<string, any>[], columns: ExportColumn[], format: string, filenameBase: string) {
  if (format !== "csv" && format !== "xlsx") {
    return res.status(400).json({ message: "Formato inválido. Use 'csv' ou 'xlsx'." });
  }
  if (format === "csv") {
    const csv = generateCSV(data, columns);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filenameBase}_${Date.now()}.csv"`);
    return res.send(csv);
  }
  const buffer = generateXLSX(data, columns);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filenameBase}_${Date.now()}.xlsx"`);
  res.send(buffer);
}

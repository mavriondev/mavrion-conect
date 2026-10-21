import React from "react";

// Renderizador leve de markdown para saídas de IA (sem dependências).
// Suporta: títulos (#..####), tabelas |a|b|, listas com marcadores ou numeradas,
// **negrito**, linhas separadoras (---, ═══) e parágrafos.

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**") && p.length > 4) {
      return (
        <strong key={`${keyPrefix}-b${i}`} className="font-semibold">
          {p.slice(2, -2)}
        </strong>
      );
    }
    return <React.Fragment key={`${keyPrefix}-t${i}`}>{p}</React.Fragment>;
  });
}

function splitTableRow(line: string): string[] {
  let l = line.trim();
  if (l.startsWith("|")) l = l.slice(1);
  if (l.endsWith("|")) l = l.slice(0, -1);
  return l.split("|").map(c => c.trim());
}

export function AiMarkdown({ text, className }: { text: string; className?: string }) {
  const lines = (text || "").replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const trimmed = lines[i].trim();

    // Bloco de tabela
    if (trimmed.startsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        tableLines.push(lines[i].trim());
        i++;
      }
      const rows = tableLines
        .filter(l => !/^\|[\s\-:|]+\|?$/.test(l))
        .map(splitTableRow);
      if (rows.length > 0) {
        const [header, ...body] = rows;
        blocks.push(
          <div key={key++} className="overflow-x-auto my-2">
            <table className="w-full text-xs border border-border rounded-md">
              <thead>
                <tr className="bg-muted/60">
                  {header.map((h, hi) => (
                    <th key={hi} className="text-left font-semibold px-2 py-1.5 border-b border-border whitespace-nowrap">
                      {renderInline(h, `h${key}-${hi}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {body.map((r, ri) => (
                  <tr key={ri} className="border-b border-border/50 last:border-0">
                    {r.map((c, ci) => (
                      <td key={ci} className="px-2 py-1.5 align-top">
                        {renderInline(c, `c${key}-${ri}-${ci}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      continue;
    }

    // Linhas vazias e separadores decorativos
    if (trimmed === "" || /^[=─═\-_*]{3,}$/.test(trimmed)) {
      i++;
      continue;
    }

    // Títulos
    const h = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const cls =
        level <= 2
          ? "text-sm font-bold mt-4 mb-1.5 first:mt-0"
          : "text-[13px] font-semibold mt-3 mb-1 first:mt-0";
      blocks.push(
        <p key={key++} className={cls}>
          {renderInline(h[2], `hd${key}`)}
        </p>
      );
      i++;
      continue;
    }

    // Listas (agrupa itens consecutivos; preserva numeração)
    const listRe = /^([-*•]|\d+[.)])\s+(.*)$/;
    if (listRe.test(trimmed)) {
      const items: { marker: string; text: string }[] = [];
      while (i < lines.length) {
        const m = lines[i].trim().match(listRe);
        if (!m) break;
        items.push({ marker: m[1], text: m[2] });
        i++;
      }
      blocks.push(
        <ul key={key++} className="space-y-1 my-1.5">
          {items.map((it, ii) => (
            <li key={ii} className="text-sm leading-relaxed flex gap-2">
              <span className="text-muted-foreground shrink-0">
                {/^\d/.test(it.marker) ? it.marker : "•"}
              </span>
              <span>{renderInline(it.text, `li${key}-${ii}`)}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Parágrafo
    blocks.push(
      <p key={key++} className="text-sm leading-relaxed my-1.5">
        {renderInline(trimmed, `p${key}`)}
      </p>
    );
    i++;
  }

  return <div className={className}>{blocks}</div>;
}

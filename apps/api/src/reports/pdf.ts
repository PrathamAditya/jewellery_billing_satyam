import { cellText, type Cell, type ReportTable } from "./table";

/**
 * Spec 031 R-PDF: a small PDF writer for report tables. A4 landscape, the built-in Helvetica fonts
 * (no font file to ship). Helvetica has no rupee sign, so money is printed without a symbol and the
 * headers say (Rs). Characters outside plain ASCII are shown as "?".
 */

const PAGE_W = 842;
const PAGE_H = 595;
const MARGIN = 36;
const TABLE_W = PAGE_W - 2 * MARGIN;
const ROW_H = 14;
const FONT = 8.5;

/** Rough Helvetica advance widths in em, enough to right-align and to cut text to a column. */
function charWidth(ch: string): number {
  if (/[0-9]/.test(ch)) return 0.556;
  if (ch === " " || ch === "," || ch === "." || ch === "'" || ch === "!" || ch === "|") return 0.278;
  if (ch === "-" || ch === "(" || ch === ")" || ch === "/") return 0.333;
  if (/[A-Z]/.test(ch)) return 0.667;
  if (/[iljtfr]/.test(ch)) return 0.3;
  if (/[a-z]/.test(ch)) return 0.5;
  return 0.556;
}

const textWidth = (s: string, size: number) => [...s].reduce((w, ch) => w + charWidth(ch) * size, 0);

/** Only printable ASCII in the file: the rupee sign becomes "Rs ", other characters "?". */
export function pdfSafe(value: string): string {
  return value
    .replace(/₹/g, "Rs ")
    .replace(/[–—]/g, "-")
    .replace(/[^\x20-\x7e]/g, "?");
}

/** Escapes text for a PDF string literal. */
const pdfString = (s: string) => `(${s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")})`;

function fit(text: string, size: number, maxWidth: number): string {
  if (textWidth(text, size) <= maxWidth) return text;
  let t = text;
  while (t.length > 0 && textWidth(t + "..", size) > maxWidth) t = t.slice(0, -1);
  return t + "..";
}

export function buildPdf(table: ReportTable, generatedOn: string): Uint8Array {
  // Column widths in points, scaled from the relative widths.
  const total = table.columns.reduce((s, c) => s + c.width, 0);
  const cols = table.columns.map((c) => ({ ...c, x: 0, w: (c.width / total) * TABLE_W }));
  let x = MARGIN;
  for (const c of cols) {
    c.x = x;
    x += c.w;
  }

  const pages: string[][] = [];
  let ops: string[] = [];
  let y = 0;
  const pageTop = PAGE_H - MARGIN;
  const bottomLimit = MARGIN + 28;

  const text = (s: string, px: number, py: number, size: number, bold = false) => {
    ops.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${px.toFixed(2)} ${py.toFixed(2)} Td ${pdfString(pdfSafe(s))} Tj ET`);
  };
  const rule = (py: number, weight: number) => ops.push(`${weight} w ${MARGIN} ${py.toFixed(2)} m ${PAGE_W - MARGIN} ${py.toFixed(2)} l S`);
  const cellAt = (c: (typeof cols)[number], value: Cell, py: number, bold: boolean) => {
    const raw = cellText(value);
    const shown = fit(pdfSafe(raw), FONT, c.w - 8);
    const w = textWidth(shown, FONT);
    const px = c.align === "right" ? c.x + c.w - 4 - w : c.x + 4;
    text(shown, px, py, FONT, bold);
  };

  // Header labels wrap onto up to three lines, at spaces, so long names fit their column.
  const wrapLabel = (label: string, maxWidth: number): string[] => {
    const lines: string[] = [];
    let cur = "";
    for (const word of pdfSafe(label).split(" ")) {
      const next = cur ? `${cur} ${word}` : word;
      if (textWidth(next, FONT) <= maxWidth || !cur) cur = next;
      else {
        lines.push(cur);
        cur = word;
      }
    }
    if (cur) lines.push(cur);
    return lines.map((l) => fit(l, FONT, maxWidth));
  };
  const header = () => {
    text(table.title, MARGIN, pageTop - 14, 14, true);
    text(table.subtitle, MARGIN, pageTop - 30, 9);
    y = pageTop - 48;
    const labels = cols.map((c) => wrapLabel(c.label, c.w - 8));
    const lines = Math.max(...labels.map((l) => l.length));
    labels.forEach((ls, i) => {
      const c = cols[i]!;
      ls.forEach((l, k) => {
        const w = textWidth(l, FONT);
        text(l, c.align === "right" ? c.x + c.w - 4 - w : c.x + 4, y - k * 10, FONT, true);
      });
    });
    y -= (lines - 1) * 10;
    y -= 4;
    rule(y, 0.6);
    y -= ROW_H - 4;
  };
  const newPage = () => {
    if (ops.length) pages.push(ops);
    ops = [];
    header();
  };

  newPage();
  for (const row of table.rows) {
    if (y - ROW_H < bottomLimit) newPage();
    row.forEach((v, i) => cellAt(cols[i]!, v, y, false));
    y -= ROW_H;
  }
  if (table.totals) {
    if (y - ROW_H * 2 < bottomLimit) newPage();
    rule(y + ROW_H - 4, 0.6);
    table.totals.forEach((v, i) => cellAt(cols[i]!, v, y - 2, true));
    y -= ROW_H;
  }
  if (table.notes.length) {
    if (y - ROW_H * (table.notes.length + 1) < bottomLimit) newPage();
    y -= ROW_H;
    for (const note of table.notes) {
      text(note, MARGIN, y, 8);
      y -= 11;
    }
  }
  pages.push(ops);

  const total_pages = pages.length;
  const footer = (n: number) => `Page ${n} of ${total_pages}   |   ${pdfSafe(table.title)}   |   Printed ${pdfSafe(generatedOn)}`;
  const streams = pages.map((p, i) => {
    const foot = `BT /F1 7.5 Tf ${MARGIN} 20 Td ${pdfString(footer(i + 1))} Tj ET`;
    return [...p, foot].join("\n");
  });

  // Object layout: 1 catalog, 2 pages, 3 Helvetica, 4 Helvetica-Bold, then a page and a content stream per page.
  const objects: string[] = [];
  const pageIds = pages.map((_, i) => 5 + i * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  pages.forEach((_, i) => {
    const pid = pageIds[i]!;
    const cid = pid + 1;
    objects[pid] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${cid} 0 R >>`;
    const body = streams[i]!;
    objects[cid] = `<< /Length ${body.length} >>\nstream\n${body}\nendstream`;
  });

  let out = "%PDF-1.4\n"; // ASCII only, so string offsets are byte offsets
  const offsets: number[] = [];
  const count = objects.length; // ids 0..count-1; id 0 is the free entry
  for (let id = 1; id < count; id++) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let id = 1; id < count; id++) out += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

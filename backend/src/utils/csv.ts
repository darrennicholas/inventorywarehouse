/** CSV cells are quoted and spreadsheet formula prefixes are neutralized. */
export function csvCell(value: unknown) {
  let text = value == null ? "" : String(value);
  if (typeof value !== "number" && /^[\s\u0000-\u001f]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function csvDocument(rows: unknown[][]) {
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
}

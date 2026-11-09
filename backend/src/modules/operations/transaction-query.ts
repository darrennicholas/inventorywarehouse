/** Shared query helpers for purchase and sales list routes. */
export function dateRange(query: Record<string, unknown>, field: string) {
  const range: { gte?: Date; lt?: Date } = {};
  const validDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  const from = validDate(query.fromDate) ? query.fromDate : "";
  const to = validDate(query.toDate) ? query.toDate : "";
  if (from) range.gte = new Date(`${from}T00:00:00.000+07:00`);
  if (to) {
    const exclusive = new Date(`${to}T00:00:00.000+07:00`);
    exclusive.setUTCDate(exclusive.getUTCDate() + 1);
    range.lt = exclusive;
  }
  return Object.keys(range).length ? { [field]: range } : null;
}

export function sumItems(items: ReadonlyArray<{ quantity: number; unitPrice: number }>) {
  return items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
}

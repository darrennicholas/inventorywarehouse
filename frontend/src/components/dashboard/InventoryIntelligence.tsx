"use client";

import { useEffect, useState } from "react";
import { useApiQuery } from "@/hooks/useApiQuery";
import { useAuth } from "@/components/auth/AuthProvider";
import { apiRequest } from "@/lib/api";
import { confirmAction } from "@/components/ui/GlobalAlert";
import GlobalSelect from "@/components/ui/GlobalSelect";

type Reorder = { productId: string; productName: string; available: number; incomingQuantity: number | null; targetStock: number; suggestedQuantity: number; suggestedPurchaseDate: string | null };
type Analytics = { kpis: { inventoryValue: number; deadStockValue: number; slowMovingCount: number; reorderCount: number; unknownCostUnits?: number }; aging: { label: string; quantity: number }[]; reorder: Reorder[] };
type Option = { id: string; name: string; code?: string };
const money = (value: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value);

function DraftPurchase({ row, close }: { row: Reorder; close: () => void }) {
  const { data, loading, error } = useApiQuery<{ warehouses: Option[]; suppliers: Option[] }>("/api/operations/options");
  const [supplierId, setSupplierId] = useState(""); const [warehouseId, setWarehouseId] = useState("");
  const [quantity, setQuantity] = useState(String(row.suggestedQuantity)); const [price, setPrice] = useState("");
  const [saving, setSaving] = useState(false); const [message, setMessage] = useState(""); const [created, setCreated] = useState(false);
  const [localSuggestion, setLocalSuggestion] = useState<{ availableQuantity: number; incomingQuantity: number | null; averageDailyUsage: number; suggestedQuantity: number; suggestedPurchaseDate: string | null } | null>(null);
  const [suggestionError, setSuggestionError] = useState("");
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  useEffect(() => {
    if (!warehouseId) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => setSuggestionLoading(true), 0);
    const params = new URLSearchParams({ warehouseId, productId: row.productId });
    void apiRequest<{ data: NonNullable<typeof localSuggestion>[] }>(`/api/operations/reorder-suggestions?${params}`, { signal: controller.signal }).then((result) => { if (!controller.signal.aborted) { const suggestion = result.data[0] ?? null; setLocalSuggestion(suggestion); setQuantity(String(suggestion?.suggestedQuantity ?? 0)); setSuggestionError(suggestion ? "" : "Produk tidak termasuk stok rendah di gudang ini."); } }).catch(() => { if (!controller.signal.aborted) { setLocalSuggestion(null); setSuggestionError("Rekomendasi gudang tidak dapat dimuat; periksa stok sebelum memesan."); } }).finally(() => { window.clearTimeout(timer); if (!controller.signal.aborted) setSuggestionLoading(false); });
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [warehouseId, row.productId]);
  async function submit() {
    const amount = Number(quantity), unitPrice = Number(price);
    if (suggestionLoading || !localSuggestion) { setMessage("Tunggu rekomendasi gudang yang valid sebelum membuat draft."); return; }
    if (!supplierId || !warehouseId || !Number.isSafeInteger(amount) || amount <= 0 || !price || !Number.isFinite(unitPrice) || unitPrice < 0) { setMessage("Pilih supplier dan gudang, isi jumlah bulat positif serta harga yang valid."); return; }
    if (!await confirmAction("Buat purchase draft untuk gudang yang dipilih? Periksa kembali jumlah dan harga. Draft belum memesan atau menambah stok.", { title: "Buat draft purchase", confirmLabel: "Buat draft" })) return;
    setSaving(true); setMessage("");
    try {
      const number = `PO-R-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      await apiRequest("/api/operations/purchases", { method: "POST", body: JSON.stringify({ number, supplierId, warehouseId, status: "DRAFT", items: [{ productId: row.productId, quantity: amount, unitPrice }] }) });
      setCreated(true); setMessage(`Draft ${number} dibuat. Buka menu Purchase untuk memeriksa dan mengajukan.`);
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "Draft tidak dapat dibuat."); }
    finally { setSaving(false); }
  }
  return <div className="sf-modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4"><div role="dialog" aria-modal="true" aria-label="Buat draft purchase" className="w-full max-w-lg rounded-2xl bg-white p-6 dark:bg-slate-900"><h3 className="text-lg font-bold">Draft purchase · {row.productName}</h3><p className="mt-2 text-xs text-slate-500">Pilih gudang untuk menghitung rekomendasi khusus lokasi. Periksa jumlah, supplier, dan harga sebelum menyimpan.</p>{loading && <p className="mt-3 text-sm">Memuat pilihan…</p>}{error && <p role="alert" className="mt-3 text-sm text-red-600">Pilihan tidak dapat dimuat.</p>}<div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold">Gudang<GlobalSelect disabled={created} value={warehouseId} onChange={(e) => { setWarehouseId(e.target.value); setLocalSuggestion(null); setSuggestionError(""); }} className="mt-1 w-full rounded-lg border p-2 dark:bg-slate-800"><option value="">Pilih gudang</option>{(data?.warehouses ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</GlobalSelect></label><label className="text-xs font-semibold">Supplier<GlobalSelect disabled={created} value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="mt-1 w-full rounded-lg border p-2 dark:bg-slate-800"><option value="">Pilih supplier</option>{(data?.suppliers ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</GlobalSelect></label><label className="text-xs font-semibold">Jumlah<input disabled={created} type="number" min="1" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="mt-1 w-full rounded-lg border p-2 dark:bg-slate-800" /></label><label className="text-xs font-semibold">Harga per unit<input disabled={created} type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} className="mt-1 w-full rounded-lg border p-2 dark:bg-slate-800" /></label></div>{localSuggestion && <p className="mt-3 text-xs text-slate-600 dark:text-slate-300">Tersedia {localSuggestion.availableQuantity} · Dalam perjalanan {localSuggestion.incomingQuantity ?? "tidak tersedia"} · Pemakaian/hari {localSuggestion.averageDailyUsage.toFixed(2)} · Rekomendasi {localSuggestion.suggestedQuantity}{localSuggestion.suggestedPurchaseDate ? ` · Pesan ${new Date(localSuggestion.suggestedPurchaseDate).toLocaleDateString("id-ID")}` : ""}</p>}{suggestionError && <p role="status" className="mt-2 text-xs text-amber-700">{suggestionError}</p>}{message && <p role="status" className={`mt-3 text-sm ${created ? "text-emerald-700" : "text-red-600"}`}>{message}</p>}<div className="mt-5 flex justify-end gap-2"><button type="button" disabled={saving} onClick={close} className="rounded-lg border px-4 py-2 text-sm">Tutup</button><button type="button" disabled={saving || loading || !!error || created} onClick={() => void submit()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Menyimpan…" : "Buat draft"}</button></div></div></div>;
}

export default function InventoryIntelligence() {
  const { data, loading } = useApiQuery<Analytics>("/api/operations/inventory-analytics");
  const { can } = useAuth(); const [selected, setSelected] = useState<Reorder | null>(null);
  if (loading || !data) return null;
  const kpis = data.kpis ?? { inventoryValue: 0, deadStockValue: 0, slowMovingCount: 0, reorderCount: 0 };
  const aging = Array.isArray(data.aging) ? data.aging : []; const reorder = Array.isArray(data.reorder) ? data.reorder : [];
  const max = Math.max(...aging.map((row) => Number(row.quantity) || 0), 1);
  return <section className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-violet-500">Stock intelligence</p><h3 className="mt-2 text-xl font-bold">Valuation, aging & replenishment</h3><p className="mt-2 text-xs text-slate-500">Nilai hanya mencakup modal tercatat. {kpis.unknownCostUnits ?? 0} unit bermodal belum diketahui tidak dihitung sebagai nol.</p></div><div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[["Known WAC inventory value", money(kpis.inventoryValue ?? 0)], ["Known dead-stock value", money(kpis.deadStockValue ?? 0)], ["Slow moving", String(kpis.slowMovingCount ?? 0)], ["Reorder now", String(kpis.reorderCount ?? 0)]].map(([label, value]) => <div key={label} className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-950/50"><p className="text-[10px] font-bold uppercase text-slate-500">{label}</p><p className="mt-2 text-lg font-black">{value}</p></div>)}</div><div className="mt-6 grid gap-5 lg:grid-cols-2"><div className="rounded-2xl border border-slate-100 p-4 dark:border-slate-800"><p className="font-bold">Stock aging</p><div className="mt-4 space-y-3">{aging.length ? aging.map((row) => <div key={row.label}><div className="flex justify-between text-xs text-slate-500"><span>{row.label}</span><span>{row.quantity} units</span></div><div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full rounded-full bg-violet-500" style={{ width: `${Number(row.quantity) / max * 100}%` }} /></div></div>) : <p className="py-5 text-center text-sm text-slate-500">No aging data yet.</p>}</div></div><div className="rounded-2xl border border-amber-100 bg-amber-50/50 p-4 dark:border-amber-900/50 dark:bg-amber-950/20"><p className="font-bold">Recommended purchase</p><div className="mt-3 space-y-2">{reorder.slice(0, 4).map((row) => <div key={row.productId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white p-3 text-xs dark:bg-slate-900"><div><p className="font-bold">{row.productName}</p><p className="mt-1 text-slate-500">Available {row.available} · Incoming {row.incomingQuantity ?? "tidak tersedia"} · Target {row.targetStock}</p></div><span className="font-black text-amber-700 dark:text-amber-300">+{row.suggestedQuantity}</span>{can("purchases.write") && can("inventory.read") && <button type="button" onClick={() => setSelected(row)} className="rounded-lg bg-blue-600 px-3 py-2 font-semibold text-white">Buat draft</button>}</div>)}{!reorder.length && <p className="py-5 text-center text-sm text-emerald-700">No urgent replenishment.</p>}</div></div></div>{selected && <DraftPurchase row={selected} close={() => setSelected(null)} />}</section>;
}

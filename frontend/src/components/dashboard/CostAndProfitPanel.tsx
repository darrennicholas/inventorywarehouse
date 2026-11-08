"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { apiRequest, downloadApiFile } from "@/lib/api";
import { confirmAction } from "@/components/ui/GlobalAlert";

type Valuation = {
  inventoryValue: string | null;
  unknownUnits: number;
  inventoryValuationAsOf?: string | null;
  inventoryValuationSource?: "DAILY_CLOSING_SNAPSHOT" | "CURRENT_BALANCE" | "UNAVAILABLE";
  historicalSnapshotAvailable?: boolean;
  revenue: string | null;
  cogs: string | null;
  grossProfit: string | null;
  grossMargin?: string | null;
  unknownCostUnits: number | null;
};

const money = (value: string | null | undefined) => value == null
  ? "Belum lengkap"
  : new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(value));

export default function CostAndProfitPanel({ from, to, warehouseId }: { from?: string; to?: string; warehouseId?: string }) {
  const { can } = useAuth();
  const [data, setData] = useState<Valuation | null>(null);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const readable = can("reports.read") && can("inventory.read");

  useEffect(() => {
    if (!readable) return;
    const controller = new AbortController();
    const query = new URLSearchParams();
    if (from) query.set("from", from);
    if (to) query.set("to", to);
    if (warehouseId) query.set("warehouseId", warehouseId);
    void apiRequest<{ data: Valuation }>(`/api/operations/valuation-profit?${query}`, { signal: controller.signal })
      .then((result) => { setData(result.data); setError(""); })
      .catch((reason) => { if (!controller.signal.aborted) { setData(null); setError(reason instanceof Error ? reason.message : "Valuasi tidak dapat dimuat."); } });
    return () => controller.abort();
  }, [from, to, warehouseId, readable]);

  if (!readable) return null;
  const stockLabel = data?.inventoryValuationSource === "DAILY_CLOSING_SNAPSHOT"
    ? `Nilai stok · snapshot ${data.inventoryValuationAsOf ? new Date(data.inventoryValuationAsOf).toLocaleDateString("id-ID") : ""}`
    : data?.inventoryValuationSource === "UNAVAILABLE" ? "Nilai stok pada tanggal tersebut" : "Nilai stok saat ini";

  return <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
    <div className="flex flex-wrap items-start justify-between gap-3"><div>
      <h3 className="font-bold">Modal & profit operasional</h3>
      <p className="mt-1 text-xs text-slate-500">Periode lampau memakai snapshot penutupan harian jika tersedia. Snapshot dimulai sejak fitur dipasang; aplikasi tidak mengarang data sebelum tanggal tersebut.</p>
    </div>{can("reports.read") && can("inventory.read") && <button type="button" disabled={exporting} onClick={() => {
      setExporting(true);
      void downloadApiFile(`/api/operations/unknown-cost-balances.csv${warehouseId ? `?warehouseId=${encodeURIComponent(warehouseId)}` : ""}`, "stock-with-unknown-cost.csv")
        .catch((reason) => setError(reason instanceof Error ? reason.message : "Ekspor gagal."))
        .finally(() => setExporting(false));
    }} className="rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-50">{exporting ? "Menyiapkan…" : "Unduh daftar modal belum diketahui"}</button>}</div>
    {error ? <p role="alert" className="text-sm text-red-600 dark:text-red-300">{error}</p> : !data ? <p className="text-sm text-slate-500">Menghitung modal dan profit…</p> : <>
      <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[[stockLabel, money(data.inventoryValue)], ["Penjualan neto · periode", can("sales.read") ? money(data.revenue) : "Akses terbatas"], ["COGS · periode", can("sales.read") ? money(data.cogs) : "Akses terbatas"], ["Gross profit · periode", can("sales.read") ? money(data.grossProfit) : "Akses terbatas"]].map(([label, value]) => <div key={label} className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-2 text-lg font-bold">{value}</dd></div>)}</dl>
      <p className="text-xs text-slate-500">{data.historicalSnapshotAvailable === false ? "Jumlah unit pada tanggal valuasi tidak tersedia." : `${data.unknownUnits} unit stok pada tanggal valuasi belum memiliki modal.`} {data.unknownCostUnits ?? "—"} unit pergerakan memiliki modal historis belum lengkap. Margin: {data.grossMargin == null ? "—" : `${Number(data.grossMargin).toFixed(2)}%`}.</p>
      {data.historicalSnapshotAvailable === false && <p role="status" className="text-xs font-medium text-amber-700 dark:text-amber-300">Snapshot historis tidak tersedia untuk tanggal tersebut.</p>}
    </>}
    <p className="text-xs text-slate-500">Modal lama tidak diasumsikan nol. Penjualan neto tidak termasuk pajak dan sudah dikurangi diskon serta return; pajak pembelian tidak dikapitalisasi. Ini bukan laporan laba bersih.</p>
  </section>;
}

export function OpeningCostPanel({ productId, warehouseId }: { productId: string; warehouseId: string }) {
  const { can } = useAuth();
  const [data, setData] = useState<{ quantityOnHand: number; averageUnitCost: string | null } | null>(null);
  const [revision, setRevision] = useState(0);
  const [cost, setCost] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const readable = can("reports.read") && can("inventory.read");

  useEffect(() => {
    if (!readable) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ productId, warehouseId });
    void apiRequest<{ data: NonNullable<typeof data> }>(`/api/operations/stock-cost?${query}`, { signal: controller.signal })
      .then((result) => { setData(result.data); setError(""); })
      .catch((value) => { if (!controller.signal.aborted) setError(value instanceof Error ? value.message : "Modal gagal dimuat."); });
    return () => controller.abort();
  }, [productId, warehouseId, readable, revision]);

  async function initialize() {
    if (!data || busy || !/^\d{1,12}(\.\d{1,6})?$/.test(cost) || reason.trim().length < 10) { setError("Isi modal nonnegatif (maks. 6 desimal) dan alasan minimal 10 karakter."); return; }
    if (!await confirmAction(`Tetapkan modal awal ${money(cost)} per unit untuk ${data.quantityOnHand} unit stok? Gunakan bukti nilai persediaan; pergerakan historis tidak ditulis ulang.`, { title: "Tetapkan modal awal", confirmLabel: "Tetapkan" })) return;
    setBusy(true); setError("");
    try { await apiRequest("/api/operations/stock-cost/opening", { method: "POST", body: JSON.stringify({ productId, warehouseId, expectedQuantity: data.quantityOnHand, unitCost: cost, reason: reason.trim() }) }); setRevision((value) => value + 1); }
    catch (value) { setError(value instanceof Error ? value.message : "Modal gagal disimpan."); }
    finally { setBusy(false); }
  }
  if (!readable) return null;
  return <div className="mt-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700"><h4 className="text-sm font-semibold">Modal rata-rata gudang</h4>{error && <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-300">{error}</p>}{data && <p className="mt-2 text-xs">Modal/unit: <strong>{data.averageUnitCost == null ? "Belum diketahui" : money(data.averageUnitCost)}</strong> · Fisik: {data.quantityOnHand}</p>}{data?.averageUnitCost === null && can("adjustments.approve") && <fieldset disabled={busy} className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-xs">Modal awal / unit<input value={cost} type="number" min="0" step="0.000001" onChange={(event) => setCost(event.target.value)} className="mt-1 w-full rounded-lg border p-2 dark:bg-slate-900" /></label><label className="text-xs">Alasan / referensi bukti<input value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} className="mt-1 w-full rounded-lg border p-2 dark:bg-slate-900" /></label><p className="text-xs text-slate-500 sm:col-span-2">Hanya saldo lama yang modalnya belum diketahui yang dapat diinisialisasi. Perubahan setelah itu mengikuti penerimaan berikutnya.</p><button type="button" onClick={() => void initialize()} className="w-fit rounded-lg bg-blue-600 px-3 py-2 text-xs text-white">{busy ? "Menyimpan…" : "Tetapkan modal awal"}</button></fieldset>}</div>;
}

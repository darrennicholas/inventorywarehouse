"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { apiRequest } from "@/lib/api";
import GlobalSelect from "@/components/ui/GlobalSelect";
import { confirmAction } from "@/components/ui/GlobalAlert";

type Row = { id: string; productId: string; warehouseId: string; quantityOnHand: number; reservedQuantity: number; product: { name: string; sku: string }; location: { code: string }; warehouse: { name: string }; batch?: { batchNumber: string } | null };
type Decision = { id: string; createdById: string; action: string; quantity: number; status: string; reason: string; reviewNotes?: string; returnOrderId?: string; source: Row; createdBy: { fullName: string }; approvedBy?: { fullName: string } | null };
type Queue = { rows: Row[]; decisions: Decision[]; locations: { id: string; warehouseId: string; name: string; code: string }[]; purchaseSources: { id: string; productId: string; purchaseOrder: { number: string; warehouseId: string } }[] };
const field = "mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm dark:border-slate-600 dark:bg-slate-900";
const actionNames: Record<string, string> = { RELEASE: "Lepas ke penyimpanan", SCRAP: "Musnahkan / scrap", RETURN_SUPPLIER: "Kembalikan ke supplier" };

export default function QuarantinePanel({ warehouseId }: { warehouseId?: string }) {
  const { user, can } = useAuth();
  const [data, setData] = useState<Queue | null>(null); const [revision, setRevision] = useState(0);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(""); const [action, setAction] = useState("RELEASE"); const [quantity, setQuantity] = useState("1");
  const [destination, setDestination] = useState(""); const [purchaseItem, setPurchaseItem] = useState(""); const [reason, setReason] = useState("");
  const [reviewId, setReviewId] = useState(""); const [reviewNotes, setReviewNotes] = useState("");
  const row = data?.rows.find((item) => item.id === selected);
  useEffect(() => {
    const controller = new AbortController(); const query = warehouseId ? `?warehouseId=${encodeURIComponent(warehouseId)}` : "";
    void apiRequest<{ data: Queue }>(`/api/operations/quarantine${query}`, { signal: controller.signal }).then((result) => { setData(result.data); setError(""); }).catch((value) => { if (!controller.signal.aborted) setError(value instanceof Error ? value.message : "Gagal memuat karantina."); });
    return () => controller.abort();
  }, [warehouseId, revision]);
  async function request() {
    if (!row || busy) return;
    if (!Number.isSafeInteger(Number(quantity)) || Number(quantity) <= 0 || reason.trim().length < 10) { setError("Isi jumlah bulat positif dan alasan minimal 10 karakter."); return; }
    if (!await confirmAction(`${actionNames[action]} sebanyak ${quantity} unit? Pengajuan perlu diperiksa pengguna lain sebelum stok berubah.`, { title: "Ajukan penanganan", confirmLabel: "Ajukan" })) return;
    setBusy(true); setError("");
    try { await apiRequest("/api/operations/quarantine", { method: "POST", body: JSON.stringify({ locationBalanceId: row.id, action, quantity: Number(quantity), reason: reason.trim(), ...(action === "RELEASE" ? { destinationLocationId: destination } : {}), ...(action === "RETURN_SUPPLIER" ? { purchaseOrderItemId: purchaseItem } : {}) }) }); setSelected(""); setReason(""); setRevision((value) => value + 1); }
    catch (value) { setError(value instanceof Error ? value.message : "Pengajuan gagal."); } finally { setBusy(false); }
  }
  async function review(approve: boolean) {
    if (busy || !reviewId || reviewNotes.trim().length < 10) { setError("Catatan review minimal 10 karakter."); return; }
    if (!await confirmAction(approve ? "Setujui penanganan ini? Stok langsung berubah sesuai tindakan; pengembalian supplier menghasilkan purchase return posted." : "Tolak pengajuan ini tanpa mengubah stok?", { title: approve ? "Setujui penanganan" : "Tolak pengajuan", confirmLabel: approve ? "Setujui" : "Tolak" })) return;
    setBusy(true); setError("");
    try { await apiRequest(`/api/operations/quarantine/${reviewId}/review`, { method: "POST", body: JSON.stringify({ approve, notes: reviewNotes.trim() }) }); setReviewId(""); setReviewNotes(""); setRevision((value) => value + 1); }
    catch (value) { setError(value instanceof Error ? value.message : "Review gagal."); } finally { setBusy(false); }
  }
  return <section className="mt-5 space-y-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
    <div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold">Tindak lanjut karantina</h3><p className="mt-1 text-xs text-slate-500">Barang rusak tidak bisa dijual. Ajukan pelepasan, scrap, atau return supplier; persetujuan wajib oleh pengguna lain.</p></div><button type="button" disabled={busy} onClick={() => setRevision((value) => value + 1)} className="text-xs font-semibold text-blue-600 dark:text-blue-300">Muat ulang</button></div>
    {error && <p role="alert" className="text-sm text-red-600 dark:text-red-300">{error}</p>}
    {!data ? <p className="text-sm text-slate-500">Memuat karantina…</p> : <>
      {!data.rows.length && <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500 dark:bg-slate-800">Tidak ada stok di lokasi karantina/rusak.</p>}
      <div className="max-h-72 space-y-2 overflow-y-auto">{data.rows.map((item) => <article key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-xs dark:border-slate-700"><div><p className="font-semibold">{item.product.name} · {item.product.sku}</p><p className="mt-1 text-slate-500">{item.warehouse.name} / {item.location.code} · {item.batch?.batchNumber ?? "Tanpa batch"}</p><p className="mt-1">Fisik {item.quantityOnHand} · reservasi {item.reservedQuantity}</p></div>{can("inventory.write") && <button type="button" disabled={busy} onClick={() => { setSelected(item.id); setQuantity("1"); setDestination(""); setPurchaseItem(""); }} className="rounded-lg bg-blue-600 px-3 py-2 text-white">Ajukan penanganan</button>}</article>)}</div>
      {row && <fieldset disabled={busy} className="grid gap-3 rounded-lg bg-slate-50 p-4 sm:grid-cols-2 dark:bg-slate-800"><legend className="text-sm font-semibold">Penanganan {row.product.name}</legend>
        <label className="text-xs">Tindakan<GlobalSelect value={action} onChange={(event) => setAction(event.target.value)} className={field}><option value="RELEASE">Lepas ke penyimpanan</option><option value="SCRAP">Musnahkan / scrap</option>{can("purchase-returns.write") && can("purchases.read") && <option value="RETURN_SUPPLIER">Return supplier</option>}</GlobalSelect></label>
        <label className="text-xs">Jumlah (maks. {row.quantityOnHand - row.reservedQuantity})<input type="number" min="1" max={row.quantityOnHand - row.reservedQuantity} step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} className={field} /></label>
        {action === "RELEASE" && <label className="text-xs sm:col-span-2">Lokasi penyimpanan tujuan<GlobalSelect value={destination} onChange={(event) => setDestination(event.target.value)} className={field}><option value="">Pilih lokasi</option>{data.locations.filter((item) => item.warehouseId === row.warehouseId).map((item) => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</GlobalSelect></label>}
        {action === "RETURN_SUPPLIER" && <label className="text-xs sm:col-span-2">Purchase asal (bukti receipt divalidasi server)<GlobalSelect value={purchaseItem} onChange={(event) => setPurchaseItem(event.target.value)} className={field}><option value="">Pilih purchase</option>{data.purchaseSources.filter((item) => item.productId === row.productId && item.purchaseOrder.warehouseId === row.warehouseId).map((item) => <option key={item.id} value={item.id}>{item.purchaseOrder.number}</option>)}</GlobalSelect></label>}
        <label className="text-xs sm:col-span-2">Alasan / hasil pemeriksaan<textarea value={reason} maxLength={1000} onChange={(event) => setReason(event.target.value)} className={field} /></label>
        <div className="flex gap-3 sm:col-span-2"><button type="button" onClick={() => void request()} disabled={(action === "RELEASE" && !destination) || (action === "RETURN_SUPPLIER" && !purchaseItem)} className="rounded-lg bg-blue-600 px-3 py-2 text-xs text-white disabled:opacity-50">{busy ? "Mengajukan…" : "Kirim pengajuan"}</button><button type="button" onClick={() => setSelected("")} className="text-xs">Batal</button></div>
      </fieldset>}
      <div><h4 className="text-sm font-semibold">Pengajuan & riwayat</h4><p className="text-xs text-slate-500">Maksimal 100 saldo dan 100 pengajuan terbaru.</p></div>
      <div className="max-h-80 space-y-2 overflow-y-auto">{data.decisions.map((item) => <article key={item.id} className="rounded-lg border p-3 text-xs dark:border-slate-700"><div className="flex flex-wrap justify-between gap-2"><strong>{actionNames[item.action]} · {item.quantity} unit · {item.status}</strong><span>{item.source.product.name}</span></div><p className="mt-1">{item.reason}</p><p className="mt-1 text-slate-500">Pengaju: {item.createdBy.fullName}{item.approvedBy ? ` · Pemeriksa: ${item.approvedBy.fullName}` : ""}</p>{item.reviewNotes && <p className="mt-1">Review: {item.reviewNotes}</p>}{item.returnOrderId && <p className="mt-1 text-blue-600 dark:text-blue-300">Purchase return telah dibuat; lihat menu Purchase Return.</p>}{item.status === "PENDING" && can("adjustments.approve") && item.createdById !== user?.id && (item.action !== "RETURN_SUPPLIER" || can("purchase-returns.approve")) && <button type="button" disabled={busy} onClick={() => { setReviewId(item.id); setReviewNotes(""); }} className="mt-2 font-semibold text-blue-600 dark:text-blue-300">Review pengajuan</button>}</article>)}</div>
      {reviewId && <fieldset disabled={busy} className="rounded-lg border border-amber-200 p-3 dark:border-amber-800"><legend className="text-xs font-semibold">Catatan keputusan</legend><textarea aria-label="Catatan review" value={reviewNotes} maxLength={1000} onChange={(event) => setReviewNotes(event.target.value)} className={field} /><div className="mt-3 flex gap-3"><button type="button" onClick={() => void review(true)} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs text-white">Setujui & proses stok</button><button type="button" onClick={() => void review(false)} className="rounded-lg border px-3 py-2 text-xs dark:border-slate-600">Tolak</button><button type="button" onClick={() => setReviewId("")} className="text-xs">Batal</button></div></fieldset>}
    </>}
  </section>;
}

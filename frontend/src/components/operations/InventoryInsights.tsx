"use client";

import { useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/api";
import GlobalSelect from "@/components/ui/GlobalSelect";
import type { NotificationTarget } from "@/types/notification";
import { OpeningCostPanel } from "@/components/dashboard/CostAndProfitPanel";

type Item = { key: string; productId: string; quantity: string; locationId: string; sourceLocationId: string; batchId: string };
type StockLine = { id: string; quantityOnHand?: number | string; reservedQuantity?: number | string; availableQuantity?: number | string; quarantineQuantity?: number; expiredQuantity?: number; otherUnavailableQuantity?: number; detailMissing?: boolean; product?: { id?: string; name?: string; sku?: string; barcode?: string }; warehouse?: { id?: string; name?: string } };
type Availability = { product: { name: string }; onHand: number; reserved: number; available: number; locations: { location: { code: string }; batch: { batchNumber: string } | null; available: number }[] };
type Movement = { id: string; occurredAt: string; movementType: string; quantity: number; before: number; after: number; actor: string; source: { kind: string; number: string | null } | null };
type Source = { kind: string; number: string; status: string; notes: string | null; items: { product: string; sku: string; quantity: number }[] };

function Reconciliation({ productId, warehouseId }: { productId: string; warehouseId: string }) {
  const [data, setData] = useState<{ checks: { label: string; expected: number; actual: number; difference: number }[]; movementTotal: number; movementCount: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function check() {
    setLoading(true); setError(""); setData(null);
    try { const query = new URLSearchParams({ productId, warehouseId }); const response = await apiRequest<{ data: NonNullable<typeof data> }>(`/api/operations/stock-reconciliation?${query}`); setData(response.data); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Pemeriksaan gagal."); }
    finally { setLoading(false); }
  }
  return <div className="mt-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700"><div className="flex flex-wrap items-center justify-between gap-3"><div><h4 className="text-sm font-semibold">Pemeriksaan konsistensi stok</h4><p className="text-xs text-slate-500">Hanya membaca data; koreksi dilakukan melalui adjustment atau opname.</p></div><button type="button" disabled={loading} onClick={() => void check()} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{loading ? "Memeriksa…" : "Periksa stok"}</button></div>{error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}{data && <div className="mt-3 space-y-2">{data.checks.map((item) => <p key={item.label} className={`text-xs ${item.difference ? "text-red-700 dark:text-red-300" : "text-emerald-700 dark:text-emerald-300"}`}>{item.label}: {item.expected} / {item.actual} {item.difference ? `(selisih ${item.difference})` : "· sesuai"}</p>)}<p className="text-xs text-slate-500">Total pergerakan tercatat: {data.movementTotal} ({data.movementCount} catatan). Saldo awal lama mungkin tidak memiliki riwayat lengkap.</p></div>}</div>;
}

function AvailabilityLine({ item, warehouseId, outgoing, requested }: { item: Item; warehouseId: string; outgoing: boolean; requested: number }) {
  const [data, setData] = useState<Availability | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const locationId = item.sourceLocationId || item.locationId;
  useEffect(() => {
    if (!warehouseId || !item.productId) return;
    let active = true;
    const params = new URLSearchParams({ warehouseId, productId: item.productId });
    if (locationId) params.set("locationId", locationId);
    if (item.batchId) params.set("batchId", item.batchId);
    const timer = window.setTimeout(() => {
      setLoading(true); setError(""); setData(null);
      void apiRequest<{ data: Availability }>(`/api/operations/availability?${params}`).then((response) => { if (active) setData(response.data); }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Stok tidak dapat dimuat."); }).finally(() => { if (active) setLoading(false); });
    }, 200);
    return () => { active = false; window.clearTimeout(timer); };
  }, [warehouseId, item.productId, item.batchId, locationId]);
  if (!warehouseId || !item.productId) return null;
  const insufficient = data && outgoing && requested > data.available;
  return <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs dark:border-slate-700 dark:bg-slate-900">
    <p className="font-semibold text-slate-800 dark:text-slate-100">{data?.product.name ?? "Memeriksa produk"}</p>
    {loading ? <p className="mt-1 text-slate-500">Memuat stok...</p> : error ? <p role="alert" className="mt-1 text-red-600">{error}</p> : data && <>
      <p className="mt-1 text-slate-600 dark:text-slate-300">Fisik {data.onHand} · Direservasi {data.reserved} · <strong>Tersedia {data.available}</strong></p>
      <p className="mt-1 text-slate-500">{data.locations.length ? data.locations.map((row) => `${row.location.code}${row.batch ? ` / ${row.batch.batchNumber}` : ""}: ${row.available}`).join(" · ") : "Tidak ada stok yang dapat dialokasikan pada pilihan ini."}</p>
      {insufficient && <p role="alert" className="mt-2 font-semibold text-red-700 dark:text-red-300">Jumlah yang diminta melebihi stok tersedia. Periksa gudang, lokasi, batch, atau jumlah sebelum memproses.</p>}
    </>}
  </div>;
}

export function StockAvailabilityPanel({ warehouseId, items, outgoing }: { warehouseId: string; items: Item[]; outgoing: boolean }) {
  if (!warehouseId || !items.some((item) => item.productId)) return null;
  return <section className="space-y-2 rounded-2xl bg-slate-50 p-4 dark:bg-slate-800"><h4 className="text-sm font-semibold text-slate-900 dark:text-white">Stok yang dapat digunakan</h4><p className="text-xs text-slate-500 dark:text-slate-300">Lokasi penyimpanan aktif dan batch yang belum kedaluwarsa. Stok dapat berubah sebelum transaksi diproses.</p>{items.filter((item) => item.productId).map((item) => <AvailabilityLine key={`${item.key}-${warehouseId}-${item.productId}-${item.locationId}-${item.sourceLocationId}-${item.batchId}`} item={item} warehouseId={warehouseId} outgoing={outgoing} requested={items.filter((other) => other.productId === item.productId && (other.sourceLocationId || other.locationId) === (item.sourceLocationId || item.locationId) && other.batchId === item.batchId).reduce((sum, other) => sum + (Number(other.quantity) || 0), 0)} />)}</section>;
}

export function StockHistoryPanel({ rows, target, warehouseId: warehouseFilter }: { rows: StockLine[]; target?: NotificationTarget | null; warehouseId?: string }) {
  const [selected, setSelected] = useState("");
  const [selectedRow, setSelectedRow] = useState<StockLine | null>(null);
  const [optionSearch, setOptionSearch] = useState("");
  const [optionPage, setOptionPage] = useState(1);
  const [optionRows, setOptionRows] = useState<StockLine[]>([]);
  const [optionMeta, setOptionMeta] = useState<{ total: number; totalPages: number } | null>(null);
  const [optionLoading, setOptionLoading] = useState(false);
  const [optionError, setOptionError] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{ data: Movement[]; balance: { onHand: number; reserved: number; available: number }; meta: { totalPages: number } } | null>(null);
  const [error, setError] = useState("");
  const [source, setSource] = useState<Source | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const handledTarget = useRef(0);
  const currentRow = optionRows.find((item) => item.id === selected) ?? rows.find((item) => item.id === selected) ?? (selectedRow?.id === selected ? selectedRow : undefined);
  const row = currentRow && (!warehouseFilter || currentRow.warehouse?.id === warehouseFilter) ? currentRow : undefined;
  const productId = row?.product?.id; const warehouseId = row?.warehouse?.id;
  const stockTargetId = target?.page === "stock-report" ? target.recordId : null;
  const stockTargetToken = target?.page === "stock-report" ? target.token : null;
  useEffect(() => {
    if (!stockTargetId || stockTargetToken === null || handledTarget.current === stockTargetToken) return;
    handledTarget.current = stockTargetToken;
    let active = true;
    const params = new URLSearchParams({ balanceId: stockTargetId, page: "1", pageSize: "1" });
    void apiRequest<{ data: StockLine[] }>(`/api/operations/stock-report?${params}`).then((response) => {
      if (!active) return;
      const next = response.data[0];
      if (next) { setSelectedRow(next); setSelected(next.id); setPage(1); }
      else setError("Baris stok dari notifikasi tidak tersedia pada cakupan gudang Anda.");
    }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Baris stok dari notifikasi tidak dapat dibuka."); });
    return () => { active = false; };
  }, [stockTargetId, stockTargetToken]);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(optionPage), pageSize: "20" });
    if (warehouseFilter) params.set("warehouseId", warehouseFilter);
    if (optionSearch.trim()) params.set("search", optionSearch.trim().slice(0, 120));
    const timer = window.setTimeout(() => {
      setOptionLoading(true); setOptionError("");
      void apiRequest<{ data: StockLine[]; meta: { total: number; totalPages: number } }>(`/api/operations/stock-report?${params}`, { signal: controller.signal })
        .then((response) => { if (!controller.signal.aborted) { setOptionRows(response.data); setOptionMeta(response.meta); } })
        .catch((reason) => { if (!controller.signal.aborted) setOptionError(reason instanceof Error ? reason.message : "Pilihan produk dan gudang tidak dapat dimuat."); })
        .finally(() => { if (!controller.signal.aborted) setOptionLoading(false); });
    }, 200);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [warehouseFilter, optionSearch, optionPage]);
  useEffect(() => {
    if (!productId || !warehouseId) return;
    let active = true;
    const params = new URLSearchParams({ productId, warehouseId, page: String(page), pageSize: "20" });
    const timer = window.setTimeout(() => { setResult(null); setError(""); void apiRequest<{ data: Movement[]; balance: { onHand: number; reserved: number; available: number }; meta: { totalPages: number } }>(`/api/operations/stock-history?${params}`).then((response) => { if (active) setResult(response); }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Riwayat tidak dapat dimuat."); }); }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [productId, warehouseId, page]);
  async function openSource(id: string) {
    setSourceLoading(true); setError("");
    try { const response = await apiRequest<{ data: Source }>(`/api/operations/stock-history/${id}/source`); setSource(response.data); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Dokumen sumber tidak dapat dimuat."); }
    finally { setSourceLoading(false); }
  }
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900"><h3 className="font-bold text-slate-900 dark:text-white">Jejak pergerakan stok</h3><p className="mt-1 text-xs text-slate-500">Cari produk berdasarkan SKU, nama, atau barcode. Pilihan mencakup semua halaman laporan dalam cakupan gudang yang diizinkan.</p><label className="mt-3 block text-xs font-semibold text-slate-600 dark:text-slate-300">Cari produk<input type="search" maxLength={120} value={optionSearch} onChange={(event) => { setOptionSearch(event.target.value); setOptionPage(1); }} placeholder="Ketik SKU, nama produk, atau barcode" className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white" /></label><GlobalSelect aria-label="Pilih produk dan gudang untuk riwayat" className="mt-2 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white" value={selected} onChange={(event) => { const nextId = event.target.value; setSelected(nextId); setSelectedRow(optionRows.find((item) => item.id === nextId) ?? rows.find((item) => item.id === nextId) ?? null); setPage(1); setResult(null); setError(""); }}><option value="">Pilih produk dan gudang</option>{selectedRow && !optionRows.some((item) => item.id === selectedRow.id) && <option value={selectedRow.id}>{selectedRow.product?.sku} · {selectedRow.product?.name} — {selectedRow.warehouse?.name}</option>}{optionRows.filter((item) => item.product?.id && item.warehouse?.id).map((item) => <option key={item.id} value={item.id}>{item.product?.sku} · {item.product?.name} — {item.warehouse?.name}</option>)}</GlobalSelect><div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">{optionError ? <span role="alert" className="text-red-600">{optionError}</span> : <span>{optionLoading ? "Memuat pilihan…" : `${optionMeta?.total ?? 0} saldo cocok`}</span>}<div className="flex items-center gap-2"><button type="button" disabled={optionLoading || optionPage <= 1} onClick={() => setOptionPage((current) => current - 1)} className="rounded-lg border border-slate-200 bg-blue-50 px-3 py-1.5 font-semibold text-blue-800 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-45">Sebelumnya</button><span>Halaman {optionPage} / {Math.max(1, optionMeta?.totalPages ?? 1)}</span><button type="button" disabled={optionLoading || optionPage >= (optionMeta?.totalPages ?? 1)} onClick={() => setOptionPage((current) => current + 1)} className="rounded-lg border border-slate-200 bg-blue-50 px-3 py-1.5 font-semibold text-blue-800 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-45">Berikutnya</button></div></div>
    {row && <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200"><p>Fisik: {row.quantityOnHand ?? 0} · Direservasi: {row.reservedQuantity ?? 0} · Karantina: {row.quarantineQuantity ?? 0} · Kedaluwarsa: {row.expiredQuantity ?? 0} · Tidak tersedia lainnya: {row.otherUnavailableQuantity ?? 0} · <strong>Layak dialokasikan: {row.availableQuantity ?? 0}</strong></p><p className="mt-1 text-slate-500">Kategori fisik tidak saling tumpang tindih; reservasi adalah bagian dari stok fisik. Hanya lokasi penyimpanan aktif dan batch yang layak dihitung tersedia.</p>{row.detailMissing && <p role="alert" className="mt-1 font-semibold text-amber-700 dark:text-amber-300">Detail lokasi belum tersedia untuk saldo ini. Jalankan pemeriksaan stok dan koreksi melalui prosedur yang disetujui.</p>}</div>}
    {productId && warehouseId && <Reconciliation key={`reconciliation:${productId}:${warehouseId}`} productId={productId} warehouseId={warehouseId} />}
    {productId && warehouseId && <OpeningCostPanel key={`opening-cost:${productId}:${warehouseId}`} productId={productId} warehouseId={warehouseId} />}
    {selected && !result && !error && <p className="mt-3 text-sm text-slate-500">Memuat riwayat...</p>}{error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
    {result && <><p className="mt-4 text-sm text-slate-700 dark:text-slate-200">Saldo fisik: <strong>{result.balance.onHand}</strong> · Reservasi: {result.balance.reserved} · Tersedia: {result.balance.available}</p><p className="mt-1 text-xs text-slate-500">Saldo sebelum dan sesudah dihitung mundur dari saldo saat ini; perubahan lama tanpa catatan pergerakan tidak dapat ditelusuri.</p><div className="mt-3 overflow-x-auto"><table className="w-full min-w-[640px] text-left text-xs"><thead><tr className="border-b text-slate-500"><th className="p-2">Waktu / dokumen</th><th className="p-2">Jenis</th><th className="p-2">Awal</th><th className="p-2">Masuk</th><th className="p-2">Keluar</th><th className="p-2">Akhir</th></tr></thead><tbody>{result.data.map((movement) => <tr key={movement.id} className="border-b border-slate-100 dark:border-slate-700"><td className="p-2">{new Date(movement.occurredAt).toLocaleString("id-ID")}<br /><span className="text-slate-500">{movement.source?.number ? <button type="button" disabled={sourceLoading} onClick={() => void openSource(movement.id)} className="font-semibold text-blue-700 underline dark:text-blue-300">{movement.source.kind}: {movement.source.number}</button> : movement.source ? `${movement.source.kind}: akses terbatas` : "Penyesuaian / sumber lain"} · {movement.actor}</span></td><td className="p-2">{movement.movementType.replaceAll("_", " ")}</td><td className="p-2">{movement.before}</td><td className="p-2 text-emerald-700">{movement.quantity > 0 ? movement.quantity : "—"}</td><td className="p-2 text-red-700">{movement.quantity < 0 ? Math.abs(movement.quantity) : "—"}</td><td className="p-2 font-semibold">{movement.after}</td></tr>)}</tbody></table>{result.data.length === 0 && <p className="py-4 text-sm text-slate-500">Belum ada pergerakan yang tercatat.</p>}</div><div className="mt-3 flex items-center gap-3 text-xs"><button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded border px-3 py-2 disabled:opacity-40">Sebelumnya</button><span>Halaman {page} / {Math.max(1, result.meta.totalPages)}</span><button type="button" disabled={page >= result.meta.totalPages} onClick={() => setPage(page + 1)} className="rounded border px-3 py-2 disabled:opacity-40">Berikutnya</button></div></>}
    {source && <div className="sf-modal-overlay fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setSource(null); }}><div role="dialog" aria-modal="true" aria-label="Dokumen sumber" className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900"><div className="flex items-start justify-between"><div><p className="text-xs font-semibold text-blue-600">{source.kind}</p><h3 className="mt-1 text-lg font-bold text-slate-900 dark:text-white">{source.number}</h3><p className="text-sm text-slate-500">Status: {source.status.replaceAll("_", " ")}</p></div><button type="button" onClick={() => setSource(null)} className="rounded-lg border px-3 py-1 text-sm">Tutup</button></div>{source.notes && <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">{source.notes}</p>}<ul className="mt-4 divide-y divide-slate-100 dark:divide-slate-700">{source.items.map((item, index) => <li key={`${item.sku}-${index}`} className="flex justify-between gap-4 py-2 text-sm"><span>{item.product} <span className="text-xs text-slate-500">({item.sku})</span></span><strong>{item.quantity}</strong></li>)}</ul></div></div>}
  </section>;
}

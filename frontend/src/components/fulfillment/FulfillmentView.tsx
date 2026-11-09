"use client";

import GlobalLoading from "@/components/ui/GlobalLoading";
import GlobalSelect from "@/components/ui/GlobalSelect";
import { confirmAction } from "@/components/ui/GlobalAlert";
import { LoaderCircle } from "@/components/ui/GlobalLoading";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ClipboardCheck, PackageCheck, Plus, ScanLine, Search, Send, X } from "lucide-react";

import { useAuth } from "@/components/auth/AuthProvider";
import DataPagination from "@/components/ui/DataPagination";
import ActionFeedback from "@/components/ui/ActionFeedback";
import { statusLabel } from "@/lib/ui-labels";
import { fulfillmentService } from "@/services/fulfillment.service";
import type { FulfillmentRecord, FulfillmentSale, FulfillmentStatus } from "@/types/fulfillment";
import type { NotificationTarget } from "@/types/notification";

const statusStyle: Record<FulfillmentStatus, string> = {
  PICKING: "bg-amber-100 text-amber-700",
  PACKED: "bg-violet-100 text-violet-700",
  SHIPPED: "bg-blue-100 text-blue-700",
  COMPLETED: "bg-emerald-100 text-emerald-700",
  CANCELLED: "bg-rose-100 text-rose-700",
};

export default function FulfillmentView({ target = null }: { target?: NotificationTarget | null }) {
  const { can } = useAuth();
  const [rows, setRows] = useState<FulfillmentRecord[]>([]);
  const [sales, setSales] = useState<FulfillmentSale[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<FulfillmentStatus | "">("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const loadSequence = useRef(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [saleId, setSaleId] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [shippingAddress, setShippingAddress] = useState("");
  const [courier, setCourier] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [shippingId, setShippingId] = useState<string | null>(null);
  const [scanCode, setScanCode] = useState("");
  useEffect(() => {
    if (!target || target.page !== "fulfillment") return;
    const timer = window.setTimeout(() => { setSearch(target.reference); setStatus(""); setPage(1); }, 0);
    return () => window.clearTimeout(timer);
  }, [target]);

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError("");
    try {
      const [list, saleList] = await Promise.all([
        fulfillmentService.list({ status: status || undefined, search: search.trim() || undefined, page, pageSize }),
        fulfillmentService.sales(),
      ]);
      if (sequence === loadSequence.current) { setRows(Array.isArray(list.data) ? list.data : []); setTotal(list.total); setSales(Array.isArray(saleList.data) ? saleList.data : []); }
    } catch (reason) {
      if (sequence === loadSequence.current) setError(reason instanceof Error ? reason.message : "Data fulfillment tidak dapat dimuat.");
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [search, status, page, pageSize]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const selectedSale = useMemo(() => sales.find((sale) => sale.id === saleId), [sales, saleId]);
  const stats = useMemo(() => ({ picking: rows.filter((row) => row.status === "PICKING").length, packed: rows.filter((row) => row.status === "PACKED").length, shipped: rows.filter((row) => row.status === "SHIPPED").length, completed: rows.filter((row) => row.status === "COMPLETED").length }), [rows]);

  function openCreate() {
    setSaleId("");
    setQuantities({});
    setShippingAddress("");
    setCreateOpen(true);
  }

  function chooseSale(id: string) {
    const sale = sales.find((item) => item.id === id);
    setSaleId(id);
    setShippingAddress(sale?.customer?.address ?? "");
    setQuantities(Object.fromEntries((sale?.items ?? []).map((item) => [item.id, String(item.quantity)])));
  }

  async function create() {
    if (!selectedSale) return;
    const items = selectedSale.items.map((item) => ({ saleItemId: item.id, quantity: Number(quantities[item.id] ?? 0) })).filter((item) => item.quantity > 0);
    if (!items.length) { setError("Pilih minimal satu barang untuk pengiriman."); return; }
    setWorking("create");
    try {
      await fulfillmentService.createShipment(selectedSale.id, { shippingAddress: shippingAddress.trim() || null, items });
      setCreateOpen(false);
      setNotice("Pengiriman berhasil dibuat.");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to create shipment"); }
    finally { setWorking(null); }
  }

  async function act(row: FulfillmentRecord, action: "pick" | "pack" | "complete" | "cancel") {
    if (action === "cancel" && !await confirmAction(`Cancel shipment ${row.number}?`)) return;
    setWorking(`${action}:${row.id}`);
    try {
      if (action === "pick") await fulfillmentService.pick(row.id);
      if (action === "pack") await fulfillmentService.pack(row.id);
      if (action === "complete") await fulfillmentService.complete(row.id);
      if (action === "cancel") await fulfillmentService.cancel(row.id);
      setNotice(({ pick: "Barang berhasil diambil.", pack: "Barang berhasil dikemas.", complete: "Pengiriman selesai.", cancel: "Pengiriman dibatalkan." } as Record<typeof action, string>)[action]);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : `Unable to ${action} shipment`); }
    finally { setWorking(null); }
  }

  async function ship() {
    if (!shippingId || !courier.trim() || !trackingNumber.trim()) { setError("Courier and tracking number are required"); return; }
    setWorking(`ship:${shippingId}`);
    try {
      await fulfillmentService.ship(shippingId, { courier: courier.trim(), trackingNumber: trackingNumber.trim(), shippingAddress: shippingAddress.trim() || null });
      setShippingId(null); setCourier(""); setTrackingNumber(""); setNotice("Pengiriman berhasil dikonfirmasi."); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to ship order"); }
    finally { setWorking(null); }
  }

  async function scanPick() {
    const code = scanCode.trim().toLowerCase();
    if (!code) return;
    const shipment = rows.find((row) => row.status === "PICKING" && row.items.some((item) => item.pickedQuantity < item.quantity && [item.product?.barcode, item.product?.sku].some((value) => value?.toLowerCase() === code)));
    const item = shipment?.items.find((candidate) => candidate.pickedQuantity < candidate.quantity && [candidate.product?.barcode, candidate.product?.sku].some((value) => value?.toLowerCase() === code));
    if (!shipment || !item) { setError("No open picking line matches this barcode/SKU"); return; }
    setWorking(`pick:${shipment.id}`);
    try { await fulfillmentService.pick(shipment.id, [{ shipmentItemId: item.id, quantity: item.pickedQuantity + 1 }]); setScanCode(""); setNotice(`Satu unit ${item.product?.name ?? "barang"} berhasil dipindai.`); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to record scanned item"); }
    finally { setWorking(null); }
  }


  const canWrite = can("fulfillment.write");
  const canPick = can("fulfillment.pick");
  const canPack = can("fulfillment.pack");
  const canShip = can("fulfillment.ship");
  const renderActions = (row: FulfillmentRecord) => <FulfillmentActions row={row} canPick={canPick} canPack={canPack} canShip={canShip} canWrite={canWrite} working={working} onAction={(shipment, action) => void act(shipment, action)} onShip={(shipment) => { setShippingId(shipment.id); setShippingAddress(shipment.shippingAddress ?? ""); }} />;

  return <section className="space-y-5">
    <div className="rounded-3xl bg-gradient-to-br from-indigo-700 via-blue-700 to-cyan-600 p-7 text-white shadow-lg">
      <div className="flex flex-wrap items-end justify-between gap-5"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">Operasional penjualan</p><h1 className="mt-2 text-3xl font-black">Pemenuhan pesanan</h1><p className="mt-2 max-w-2xl text-sm text-white/80">Pantau pengambilan, pengemasan, pengiriman, dan penyelesaian tanpa mengurangi stok reservasi dua kali.</p></div>{canWrite && <button type="button" onClick={openCreate} className="inline-flex items-center gap-2 rounded-xl bg-blue-100 px-4 py-2.5 text-sm font-bold text-blue-900 hover:bg-blue-200"><Plus size={16} /> Buat pengiriman</button>}</div>
    </div>
    <div><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[["Sedang diambil", stats.picking, "text-amber-600"], ["Siap dikirim", stats.packed, "text-violet-600"], ["Dalam perjalanan", stats.shipped, "text-blue-600"], ["Selesai", stats.completed, "text-emerald-600"]].map(([label, value, color]) => <div key={String(label)} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"><p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</p><p className={`mt-2 text-2xl font-black sm:text-3xl ${color}`}>{value}</p></div>)}</div><p className="mt-2 text-xs text-slate-500">Ringkasan hanya menghitung pengiriman yang terlihat pada halaman ini. Total hasil filter: {total}.</p></div>
    {error && <ActionFeedback message={error} tone="error" onDismiss={() => setError("")} />}{notice && <ActionFeedback message={notice} tone="success" onDismiss={() => setNotice("")} />}
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5"><div className="flex items-center gap-3"><ClipboardCheck className="text-blue-600" size={20} /><div><h2 className="font-bold text-slate-900">Daftar pengiriman</h2><p className="text-xs text-slate-500">Penjualan, gudang, progres barang, dan tindakan yang diizinkan untuk role Anda.</p></div></div><div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row"><label className="relative w-full sm:w-auto"><span className="sr-only">Cari nomor penjualan atau pengiriman</span><Search size={15} className="absolute left-3 top-3 text-slate-400" /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Cari nomor penjualan atau pengiriman" className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-3 text-sm sm:w-64" /></label><GlobalSelect aria-label="Filter status pengiriman" value={status} onChange={(event) => { setStatus(event.target.value as FulfillmentStatus | ""); setPage(1); }} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm sm:w-auto"><option value="">Semua status</option>{(["PICKING", "PACKED", "SHIPPED", "COMPLETED", "CANCELLED"] as FulfillmentStatus[]).map((item) => <option key={item} value={item}>{statusLabel(item)}</option>)}</GlobalSelect></div></div>{canPick && <div className="flex flex-col items-stretch gap-2 border-b border-amber-100 bg-amber-50 px-5 py-3 sm:flex-row sm:items-center"><ScanLine size={16} className="hidden text-amber-700 sm:block" /><input aria-label="Pindai barcode atau SKU" value={scanCode} onChange={(event) => setScanCode(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void scanPick(); } }} placeholder="Pindai barcode/SKU untuk mengambil barang berikutnya" className="min-w-0 flex-1 rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm" /><button type="button" disabled={Boolean(working)} onClick={() => void scanPick()} className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 disabled:opacity-50">Ambil hasil pindai</button></div>}
      {loading ? (
        <div className="flex justify-center p-14 text-sm text-slate-500"><GlobalLoading label="Memuat antrean pengiriman..." /></div>
      ) : rows.length === 0 ? (
        <div className="p-14 text-center text-sm text-slate-500">Belum ada pengiriman. Pesan stok penjualan terlebih dahulu, lalu buat pengiriman.</div>
      ) : (
        <>
        <div className="divide-y divide-slate-100 md:hidden">
          {rows.map((row) => {
            const ordered = row.items.reduce((sum, item) => sum + item.quantity, 0);
            const picked = row.items.reduce((sum, item) => sum + item.pickedQuantity, 0);
            const packed = row.items.reduce((sum, item) => sum + item.packedQuantity, 0);
            return <article key={row.id} className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="break-all font-bold text-slate-900">{row.number}</p><p className="mt-1 text-xs text-slate-500">{row.sale?.number ?? row.saleId} · {row.warehouse?.name ?? "Gudang"}</p><p className="mt-1 text-xs text-slate-500">{row.sale?.customer?.name ?? "Pelanggan langsung"} · {new Date(row.createdAt).toLocaleDateString("id-ID")}</p></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${statusStyle[row.status]}`}>{statusLabel(row.status)}</span></div>
              <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3 text-xs"><p>Diambil <strong className="text-slate-800">{picked}/{ordered}</strong></p><p>Dikemas <strong className="text-slate-800">{packed}/{ordered}</strong></p><p className="col-span-2 break-all">{row.trackingNumber ? `${row.courier ?? "Kurir"} · ${row.trackingNumber}` : "Belum dikirim"}</p></div>
              <ShipmentItemDetails items={row.items} />
              <div data-sf-action-column className="flex justify-end border-t border-slate-100 pt-3">{renderActions(row)}</div>
            </article>;
          })}
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[1120px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3 font-semibold">Pengiriman</th>
                <th className="px-5 py-3 font-semibold">Penjualan / gudang</th>
                <th className="px-5 py-3 font-semibold">Barang</th>
                <th className="px-5 py-3 font-semibold">Progres</th>
                <th className="px-5 py-3 font-semibold">Kurir / resi</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="w-[170px] px-5 py-3 text-right font-semibold">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => {
                const ordered = row.items.reduce((sum, item) => sum + item.quantity, 0);
                const picked = row.items.reduce((sum, item) => sum + item.pickedQuantity, 0);
                const packed = row.items.reduce((sum, item) => sum + item.packedQuantity, 0);
                return (
                  <tr key={row.id} className="align-top transition-colors hover:bg-blue-50/50">
                    <td className="whitespace-nowrap px-5 py-4">
                      <p className="font-bold text-slate-900">{row.number}</p>
                      <p className="mt-1 text-xs text-slate-500">{new Date(row.createdAt).toLocaleDateString("id-ID")}</p>
                    </td>
                    <td className="px-5 py-4">
                      <p className="font-semibold text-slate-800">{row.sale?.number ?? row.saleId}</p>
                      <p className="mt-1 text-xs text-slate-500">{row.sale?.customer?.name ?? "Pelanggan langsung"}</p>
                      <p className="mt-1 text-xs text-slate-500">{row.warehouse?.name ?? "Gudang"}</p>
                    </td>
                    <td className="max-w-[280px] px-5 py-4">
                      <p className="truncate text-xs text-slate-700">{row.items[0]?.product?.name ?? "Produk"}{row.items.length > 1 ? ` · +${row.items.length - 1} barang` : ""}</p>
                      <ShipmentItemDetails items={row.items} compact />
                    </td>
                    <td className="whitespace-nowrap px-5 py-4 text-xs text-slate-600">
                      <p>Diambil <strong className="text-slate-800">{picked}/{ordered}</strong></p>
                      <p className="mt-1">Dikemas <strong className="text-slate-800">{packed}/{ordered}</strong></p>
                    </td>
                    <td className="px-5 py-4 text-xs">
                      {row.trackingNumber ? <><p className="font-semibold text-slate-700">{row.courier ?? "Kurir"}</p><p className="mt-1 break-all text-blue-700">{row.trackingNumber}</p></> : <span className="text-slate-400">Belum dikirim</span>}
                    </td>
                    <td className="whitespace-nowrap px-5 py-4"><span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${statusStyle[row.status]}`}>{statusLabel(row.status)}</span></td>
                    <td data-sf-action-column className="w-[170px] px-5 py-4 text-right align-middle">{renderActions(row)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}
    </div>
    {createOpen && <div className="sf-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"><div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between"><div><p className="text-xs font-bold uppercase tracking-wider text-blue-600">Buat pengiriman</p><h2 className="mt-1 text-2xl font-black text-slate-900">Mulai ambil barang dari penjualan yang stoknya sudah dipesan</h2></div><button type="button" onClick={() => setCreateOpen(false)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X size={18} /></button></div><label className="mt-5 block text-sm font-semibold text-slate-700">Penjualan dengan stok dipesan<GlobalSelect value={saleId} onChange={(event) => chooseSale(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm"><option value="">Pilih penjualan</option>{sales.map((sale) => <option key={sale.id} value={sale.id}>{sale.number} · {sale.customer?.name ?? "Konsumen umum"} · {sale.warehouse?.name}</option>)}</GlobalSelect></label>{selectedSale && <><label className="mt-4 block text-sm font-semibold text-slate-700">Alamat pengiriman<textarea value={shippingAddress} onChange={(event) => setShippingAddress(event.target.value)} rows={2} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" /></label><div className="mt-4 space-y-2">{selectedSale.items.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3"><div><p className="font-semibold text-slate-800">{item.product.name}</p><p className="text-xs text-slate-500">{item.product.sku} · Dipesan {item.quantity}</p></div><input type="number" min={0} max={item.quantity} value={quantities[item.id] ?? "0"} onChange={(event) => setQuantities((current) => ({ ...current, [item.id]: event.target.value }))} className="w-24 rounded-lg border border-slate-200 px-3 py-2 text-sm" /></div>)}</div></>}<div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setCreateOpen(false)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600">Batal</button><button type="button" disabled={working === "create" || !selectedSale} onClick={() => void create()} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">{working === "create" && <LoaderCircle size={15} className="animate-spin" />}Buat pengiriman</button></div></div></div>}
    {shippingId && <div className="sf-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"><div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between"><div><p className="text-xs font-bold uppercase tracking-wider text-blue-600">Serah terima pengiriman</p><h2 className="mt-1 text-2xl font-black text-slate-900">Tambahkan detail kurir</h2></div><button type="button" onClick={() => setShippingId(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X size={18} /></button></div><label className="mt-5 block text-sm font-semibold text-slate-700">Kurir<input value={courier} onChange={(event) => setCourier(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" placeholder="JNE, SiCepat, internal fleet..." /></label><label className="mt-3 block text-sm font-semibold text-slate-700">Nomor resi<input value={trackingNumber} onChange={(event) => setTrackingNumber(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" placeholder="Resi / delivery note" /></label><div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setShippingId(null)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600">Batal</button><button type="button" disabled={working === `ship:${shippingId}`} onClick={() => void ship()} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">{working === `ship:${shippingId}` && <LoaderCircle size={15} className="animate-spin" />}Konfirmasi pengiriman</button></div></div></div>}
    <DataPagination page={page} pageSize={pageSize} total={total} totalPages={Math.ceil(total / pageSize)} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} loading={loading} noun="pengiriman" />
  </section>;
}

function ShipmentItemDetails({ items, compact = false }: { items: FulfillmentRecord["items"]; compact?: boolean }) {
  return <details className={compact ? "mt-2 text-xs" : "rounded-xl border border-slate-200 bg-white text-sm"}>
    <summary className="w-fit cursor-pointer rounded-lg px-2 py-1 font-semibold text-blue-700 transition hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">Lihat semua barang ({items.length})</summary>
    <ul className={compact ? "mt-2 max-h-56 space-y-2 overflow-y-auto rounded-lg bg-slate-50 p-2" : "mt-2 max-h-64 space-y-2 overflow-y-auto p-3"}>
      {items.map((item) => <li key={item.id} className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
        <p className="font-semibold text-slate-800">{item.product?.name ?? "Produk"}</p>
        <p className="mt-0.5 break-all text-xs text-slate-500">SKU: {item.product?.sku ?? "—"}{item.product?.barcode ? ` · Barcode: ${item.product.barcode}` : ""}</p>
        <p className="mt-1 text-xs text-slate-600">Dipesan {item.quantity} · Diambil {item.pickedQuantity} · Dikemas {item.packedQuantity}</p>
      </li>)}
    </ul>
  </details>;
}

function FulfillmentActions({ row, canPick, canPack, canShip, canWrite, working, onAction, onShip }: {
  row: FulfillmentRecord;
  canPick: boolean;
  canPack: boolean;
  canShip: boolean;
  canWrite: boolean;
  working: string | null;
  onAction: (row: FulfillmentRecord, action: "pick" | "pack" | "complete" | "cancel") => void;
  onShip: (row: FulfillmentRecord) => void;
}) {
  const busy = Boolean(working);
  const buttons = <>
    {row.status === "PICKING" && canPick && <button type="button" aria-label={`Ambil semua barang untuk ${row.number}`} title="Ambil semua" disabled={busy} onClick={() => onAction(row, "pick")} className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500 text-white shadow-sm transition hover:bg-amber-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 disabled:opacity-50"><PackageCheck size={17} /></button>}
    {row.status === "PICKING" && canPack && <button type="button" aria-label={`Kemas pengiriman ${row.number}`} title="Kemas" disabled={busy} onClick={() => onAction(row, "pack")} className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-violet-600 text-white shadow-sm transition hover:bg-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 disabled:opacity-50"><ClipboardCheck size={17} /></button>}
    {row.status === "PACKED" && canShip && <button type="button" aria-label={`Kirim pengiriman ${row.number}`} title="Kirim" disabled={busy} onClick={() => onShip(row)} className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 text-white shadow-sm transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 disabled:opacity-50"><Send size={17} /></button>}
    {row.status === "SHIPPED" && canWrite && <button type="button" aria-label={`Selesaikan pengiriman ${row.number}`} title="Selesaikan" disabled={busy} onClick={() => onAction(row, "complete")} className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-sm transition hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 disabled:opacity-50"><Check size={17} /></button>}
    {["PICKING", "PACKED"].includes(row.status) && canWrite && <button type="button" aria-label={`Batalkan pengiriman ${row.number}`} title="Batalkan" disabled={busy} onClick={() => onAction(row, "cancel")} className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-rose-200 bg-rose-50 text-rose-700 shadow-sm transition hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:ring-offset-2 disabled:opacity-50"><X size={17} /></button>}
  </>;
  const hasButtons = (row.status === "PICKING" && (canPick || canPack || canWrite)) || (row.status === "PACKED" && (canShip || canWrite)) || (row.status === "SHIPPED" && canWrite);
  return <div className="flex items-center justify-end gap-2">{buttons}{!hasButtons && <span className="text-xs text-slate-400">—</span>}</div>;
}

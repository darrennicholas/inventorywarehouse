"use client";

import GlobalLoading from "@/components/ui/GlobalLoading";
import GlobalSelect from "@/components/ui/GlobalSelect";
import { confirmAction } from "@/components/ui/GlobalAlert";
import { LoaderCircle } from "@/components/ui/GlobalLoading";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ClipboardCheck, PackageCheck, Plus, ScanLine, Search, Send, Truck, X } from "lucide-react";

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

  return <section className="space-y-5">
    <div className="rounded-3xl bg-gradient-to-br from-indigo-700 via-blue-700 to-cyan-600 p-7 text-white shadow-lg">
      <div className="flex flex-wrap items-end justify-between gap-5"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">Operasional penjualan</p><h1 className="mt-2 text-3xl font-black">Fulfillment control tower</h1><p className="mt-2 max-w-2xl text-sm text-white/80">Handle picking, packing, shipping, tracking, and completion without consuming reserved stock twice.</p></div>{canWrite && <button type="button" onClick={openCreate} className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-slate-900"><Plus size={16} /> Buat pengiriman</button>}</div>
    </div>
    <div className="grid gap-3 sm:grid-cols-4">{[["Picking", stats.picking, "text-amber-600"], ["Packed", stats.packed, "text-violet-600"], ["Shipped", stats.shipped, "text-blue-600"], ["Completed", stats.completed, "text-emerald-600"]].map(([label, value, color]) => <div key={String(label)} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</p><p className={`mt-2 text-3xl font-black ${color}`}>{value}</p></div>)}</div>
    {error && <ActionFeedback message={error} tone="error" onDismiss={() => setError("")} />}{notice && <ActionFeedback message={notice} tone="success" onDismiss={() => setNotice("")} />}
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5"><div className="flex items-center gap-3"><ClipboardCheck className="text-blue-600" size={20} /><div><h2 className="font-bold text-slate-900">Antrean pengiriman</h2><p className="text-xs text-slate-500">Setiap pengiriman terhubung dengan penjualan yang sudah dipesan dan gudang.</p></div></div><div className="flex flex-wrap gap-2"><label className="relative"><Search size={15} className="absolute left-3 top-3 text-slate-400" /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Cari nomor penjualan atau pengiriman" className="w-64 rounded-xl border border-slate-200 py-2.5 pl-9 pr-3 text-sm" /></label><GlobalSelect value={status} onChange={(event) => { setStatus(event.target.value as FulfillmentStatus | ""); setPage(1); }} className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm"><option value="">Semua status</option>{(["PICKING", "PACKED", "SHIPPED", "COMPLETED", "CANCELLED"] as FulfillmentStatus[]).map((item) => <option key={item}>{item}</option>)}</GlobalSelect></div></div>{canPick && <div className="flex flex-wrap items-center gap-2 border-b border-amber-100 bg-amber-50 px-5 py-3"><ScanLine size={16} className="text-amber-700" /><input value={scanCode} onChange={(event) => setScanCode(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void scanPick(); } }} placeholder="Pindai barcode/SKU untuk mengambil barang berikutnya" className="min-w-[230px] flex-1 rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm" /><button type="button" disabled={Boolean(working)} onClick={() => void scanPick()} className="rounded-lg bg-amber-500 px-3 py-2 text-xs font-bold text-white">Ambil hasil pindai</button></div>}
      {loading ? <div className="flex justify-center p-14 text-sm text-slate-500"><GlobalLoading label="Memuat antrean pengiriman..." /></div> : rows.length === 0 ? <div className="p-14 text-center text-sm text-slate-500">Belum ada pengiriman. Pesan stok penjualan terlebih dahulu, lalu buat pengiriman.</div> : <div className="divide-y divide-slate-100">{rows.map((row) => <div key={row.id} className="p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div className="flex items-start gap-3"><div className="rounded-2xl bg-blue-50 p-3 text-blue-600"><Truck size={21} /></div><div><p className="font-bold text-slate-900">{row.number}</p><p className="mt-1 text-sm text-slate-500">Penjualan {row.sale?.number ?? row.saleId} · {row.sale?.customer?.name ?? "Pelanggan langsung"} · {row.warehouse?.name ?? "Gudang"}</p><p className="mt-2 text-xs text-slate-400">{row.items.map((item) => `${item.product?.name ?? "Produk"} × ${item.quantity}`).join(" · ")}</p></div></div><span className={`rounded-full px-3 py-1 text-xs font-bold ${statusStyle[row.status]}`}>{statusLabel(row.status)}</span></div><div className="mt-4 flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap gap-2 text-xs text-slate-500"><span className="rounded-lg bg-slate-100 px-2.5 py-1.5">Diambil {row.items.reduce((sum, item) => sum + item.pickedQuantity, 0)}/{row.items.reduce((sum, item) => sum + item.quantity, 0)}</span><span className="rounded-lg bg-slate-100 px-2.5 py-1.5">Dikemas {row.items.reduce((sum, item) => sum + item.packedQuantity, 0)}/{row.items.reduce((sum, item) => sum + item.quantity, 0)}</span>{row.trackingNumber && <span className="rounded-lg bg-blue-50 px-2.5 py-1.5 text-blue-700">{row.courier}: {row.trackingNumber}</span>}</div><div data-sf-action-column className="flex flex-wrap gap-2">{row.status === "PICKING" && canPick && <button type="button" disabled={Boolean(working)} onClick={() => void act(row, "pick")} className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-2 text-xs font-bold text-white"><PackageCheck size={14} /> Ambil semua</button>}{row.status === "PICKING" && canPack && <button type="button" disabled={Boolean(working)} onClick={() => void act(row, "pack")} className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold text-white"><ClipboardCheck size={14} /> Kemas</button>}{row.status === "PACKED" && canShip && <button type="button" disabled={Boolean(working)} onClick={() => { setShippingId(row.id); setShippingAddress(row.shippingAddress ?? ""); }} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white"><Send size={14} /> Kirim</button>}{row.status === "SHIPPED" && canWrite && <button type="button" disabled={Boolean(working)} onClick={() => void act(row, "complete")} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white"><Check size={14} /> Selesaikan</button>}{["PICKING", "PACKED"].includes(row.status) && canWrite && <button type="button" disabled={Boolean(working)} onClick={() => void act(row, "cancel")} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 px-3 py-2 text-xs font-bold text-rose-600"><X size={14} /> Batalkan</button>}</div></div></div>)}</div>}
    </div>
    {createOpen && <div className="sf-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"><div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between"><div><p className="text-xs font-bold uppercase tracking-wider text-blue-600">Buat pengiriman</p><h2 className="mt-1 text-2xl font-black text-slate-900">Mulai ambil barang dari penjualan yang stoknya sudah dipesan</h2></div><button type="button" onClick={() => setCreateOpen(false)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X size={18} /></button></div><label className="mt-5 block text-sm font-semibold text-slate-700">Penjualan dengan stok dipesan<GlobalSelect value={saleId} onChange={(event) => chooseSale(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm"><option value="">Pilih penjualan</option>{sales.map((sale) => <option key={sale.id} value={sale.id}>{sale.number} · {sale.customer?.name ?? "Konsumen umum"} · {sale.warehouse?.name}</option>)}</GlobalSelect></label>{selectedSale && <><label className="mt-4 block text-sm font-semibold text-slate-700">Alamat pengiriman<textarea value={shippingAddress} onChange={(event) => setShippingAddress(event.target.value)} rows={2} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" /></label><div className="mt-4 space-y-2">{selectedSale.items.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3"><div><p className="font-semibold text-slate-800">{item.product.name}</p><p className="text-xs text-slate-500">{item.product.sku} · Dipesan {item.quantity}</p></div><input type="number" min={0} max={item.quantity} value={quantities[item.id] ?? "0"} onChange={(event) => setQuantities((current) => ({ ...current, [item.id]: event.target.value }))} className="w-24 rounded-lg border border-slate-200 px-3 py-2 text-sm" /></div>)}</div></>}<div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setCreateOpen(false)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600">Batal</button><button type="button" disabled={working === "create" || !selectedSale} onClick={() => void create()} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">{working === "create" && <LoaderCircle size={15} className="animate-spin" />}Buat pengiriman</button></div></div></div>}
    {shippingId && <div className="sf-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"><div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between"><div><p className="text-xs font-bold uppercase tracking-wider text-blue-600">Serah terima pengiriman</p><h2 className="mt-1 text-2xl font-black text-slate-900">Tambahkan detail kurir</h2></div><button type="button" onClick={() => setShippingId(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X size={18} /></button></div><label className="mt-5 block text-sm font-semibold text-slate-700">Kurir<input value={courier} onChange={(event) => setCourier(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" placeholder="JNE, SiCepat, internal fleet..." /></label><label className="mt-3 block text-sm font-semibold text-slate-700">Nomor resi<input value={trackingNumber} onChange={(event) => setTrackingNumber(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" placeholder="Resi / delivery note" /></label><div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setShippingId(null)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600">Batal</button><button type="button" disabled={working === `ship:${shippingId}`} onClick={() => void ship()} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">{working === `ship:${shippingId}` && <LoaderCircle size={15} className="animate-spin" />}Konfirmasi pengiriman</button></div></div></div>}
    <DataPagination page={page} pageSize={pageSize} total={total} totalPages={Math.ceil(total / pageSize)} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} loading={loading} noun="pengiriman" />
  </section>;
}

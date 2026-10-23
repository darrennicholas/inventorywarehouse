"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ClipboardCheck, LoaderCircle, PackageCheck, Plus, ScanLine, Search, Send, Truck, X } from "lucide-react";

import { useAuth } from "@/components/auth/AuthProvider";
import { fulfillmentService } from "@/services/fulfillment.service";
import type { FulfillmentRecord, FulfillmentSale, FulfillmentStatus } from "@/types/fulfillment";

const statusStyle: Record<FulfillmentStatus, string> = {
  PICKING: "bg-amber-100 text-amber-700",
  PACKED: "bg-violet-100 text-violet-700",
  SHIPPED: "bg-blue-100 text-blue-700",
  COMPLETED: "bg-emerald-100 text-emerald-700",
  CANCELLED: "bg-rose-100 text-rose-700",
};

export default function FulfillmentView() {
  const { can } = useAuth();
  const [rows, setRows] = useState<FulfillmentRecord[]>([]);
  const [sales, setSales] = useState<FulfillmentSale[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<FulfillmentStatus | "">("");
  const [createOpen, setCreateOpen] = useState(false);
  const [saleId, setSaleId] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [shippingAddress, setShippingAddress] = useState("");
  const [courier, setCourier] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [shippingId, setShippingId] = useState<string | null>(null);
  const [scanCode, setScanCode] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [list, saleList] = await Promise.all([
        fulfillmentService.list({ status: status || undefined, search: search.trim() || undefined }),
        fulfillmentService.sales(),
      ]);
      setRows(Array.isArray(list.data) ? list.data : []);
      setSales(Array.isArray(saleList.data) ? saleList.data : []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load fulfillment data");
    } finally {
      setLoading(false);
    }
  }, [search, status]);

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
    if (!items.length) { setError("Choose at least one item for the shipment"); return; }
    setWorking("create");
    try {
      await fulfillmentService.createShipment(selectedSale.id, { shippingAddress: shippingAddress.trim() || null, items });
      setCreateOpen(false);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to create shipment"); }
    finally { setWorking(null); }
  }

  async function act(row: FulfillmentRecord, action: "pick" | "pack" | "complete" | "cancel") {
    if (action === "cancel" && !window.confirm(`Cancel shipment ${row.number}?`)) return;
    setWorking(`${action}:${row.id}`);
    try {
      if (action === "pick") await fulfillmentService.pick(row.id);
      if (action === "pack") await fulfillmentService.pack(row.id);
      if (action === "complete") await fulfillmentService.complete(row.id);
      if (action === "cancel") await fulfillmentService.cancel(row.id);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : `Unable to ${action} shipment`); }
    finally { setWorking(null); }
  }

  async function ship() {
    if (!shippingId || !courier.trim() || !trackingNumber.trim()) { setError("Courier and tracking number are required"); return; }
    setWorking(`ship:${shippingId}`);
    try {
      await fulfillmentService.ship(shippingId, { courier: courier.trim(), trackingNumber: trackingNumber.trim(), shippingAddress: shippingAddress.trim() || null });
      setShippingId(null); setCourier(""); setTrackingNumber(""); await load();
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
    try { await fulfillmentService.pick(shipment.id, [{ shipmentItemId: item.id, quantity: item.pickedQuantity + 1 }]); setScanCode(""); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to record scanned item"); }
    finally { setWorking(null); }
  }


  const canWrite = can("fulfillment.write");
  const canPick = can("fulfillment.pick");
  const canPack = can("fulfillment.pack");
  const canShip = can("fulfillment.ship");

  return <section className="space-y-5">
    <div className="rounded-3xl bg-gradient-to-br from-indigo-700 via-blue-700 to-cyan-600 p-7 text-white shadow-lg">
      <div className="flex flex-wrap items-end justify-between gap-5"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">Sales operations</p><h1 className="mt-2 text-3xl font-black">Fulfillment control tower</h1><p className="mt-2 max-w-2xl text-sm text-white/80">Handle picking, packing, shipping, tracking, and completion without consuming reserved stock twice.</p></div>{canWrite && <button type="button" onClick={openCreate} className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-slate-900"><Plus size={16} /> New shipment</button>}</div>
    </div>
    <div className="grid gap-3 sm:grid-cols-4">{[["Picking", stats.picking, "text-amber-600"], ["Packed", stats.packed, "text-violet-600"], ["Shipped", stats.shipped, "text-blue-600"], ["Completed", stats.completed, "text-emerald-600"]].map(([label, value, color]) => <div key={String(label)} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</p><p className={`mt-2 text-3xl font-black ${color}`}>{value}</p></div>)}</div>
    {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5"><div className="flex items-center gap-3"><ClipboardCheck className="text-blue-600" size={20} /><div><h2 className="font-bold text-slate-900">Shipment queue</h2><p className="text-xs text-slate-500">Every shipment is linked to a reserved sale and warehouse.</p></div></div><div className="flex flex-wrap gap-2"><label className="relative"><Search size={15} className="absolute left-3 top-3 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search sale or shipment" className="w-64 rounded-xl border border-slate-200 py-2.5 pl-9 pr-3 text-sm" /></label><select value={status} onChange={(event) => setStatus(event.target.value as FulfillmentStatus | "")} className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm"><option value="">All statuses</option>{(["PICKING", "PACKED", "SHIPPED", "COMPLETED", "CANCELLED"] as FulfillmentStatus[]).map((item) => <option key={item}>{item}</option>)}</select></div></div>{canPick && <div className="flex flex-wrap items-center gap-2 border-b border-amber-100 bg-amber-50 px-5 py-3"><ScanLine size={16} className="text-amber-700" /><input value={scanCode} onChange={(event) => setScanCode(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void scanPick(); } }} placeholder="Scan barcode/SKU to pick next unit" className="min-w-[230px] flex-1 rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm" /><button type="button" disabled={Boolean(working)} onClick={() => void scanPick()} className="rounded-lg bg-amber-500 px-3 py-2 text-xs font-bold text-white">Pick scanned</button></div>}
      {loading ? <div className="flex justify-center p-14 text-sm text-slate-500"><LoaderCircle className="mr-2 animate-spin" size={18} /> Loading shipment queue...</div> : rows.length === 0 ? <div className="p-14 text-center text-sm text-slate-500">No shipment found. Reserve a sale first, then create a shipment.</div> : <div className="divide-y divide-slate-100">{rows.map((row) => <div key={row.id} className="p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div className="flex items-start gap-3"><div className="rounded-2xl bg-blue-50 p-3 text-blue-600"><Truck size={21} /></div><div><p className="font-bold text-slate-900">{row.number}</p><p className="mt-1 text-sm text-slate-500">Sale {row.sale?.number ?? row.saleId} · {row.sale?.customer?.name ?? "Walk-in customer"} · {row.warehouse?.name ?? "Warehouse"}</p><p className="mt-2 text-xs text-slate-400">{row.items.map((item) => `${item.product?.name ?? "Product"} × ${item.quantity}`).join(" · ")}</p></div></div><span className={`rounded-full px-3 py-1 text-xs font-bold ${statusStyle[row.status]}`}>{row.status}</span></div><div className="mt-4 flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap gap-2 text-xs text-slate-500"><span className="rounded-lg bg-slate-100 px-2.5 py-1.5">Picked {row.items.reduce((sum, item) => sum + item.pickedQuantity, 0)}/{row.items.reduce((sum, item) => sum + item.quantity, 0)}</span><span className="rounded-lg bg-slate-100 px-2.5 py-1.5">Packed {row.items.reduce((sum, item) => sum + item.packedQuantity, 0)}/{row.items.reduce((sum, item) => sum + item.quantity, 0)}</span>{row.trackingNumber && <span className="rounded-lg bg-blue-50 px-2.5 py-1.5 text-blue-700">{row.courier}: {row.trackingNumber}</span>}</div><div className="flex flex-wrap gap-2">{row.status === "PICKING" && canPick && <button type="button" disabled={Boolean(working)} onClick={() => void act(row, "pick")} className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-2 text-xs font-bold text-white"><PackageCheck size={14} /> Pick all</button>}{row.status === "PICKING" && canPack && <button type="button" disabled={Boolean(working)} onClick={() => void act(row, "pack")} className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold text-white"><ClipboardCheck size={14} /> Pack</button>}{row.status === "PACKED" && canShip && <button type="button" disabled={Boolean(working)} onClick={() => { setShippingId(row.id); setShippingAddress(row.shippingAddress ?? ""); }} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white"><Send size={14} /> Ship</button>}{row.status === "SHIPPED" && canWrite && <button type="button" disabled={Boolean(working)} onClick={() => void act(row, "complete")} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white"><Check size={14} /> Complete</button>}{["PICKING", "PACKED"].includes(row.status) && canWrite && <button type="button" disabled={Boolean(working)} onClick={() => void act(row, "cancel")} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 px-3 py-2 text-xs font-bold text-rose-600"><X size={14} /> Cancel</button>}</div></div></div>)}</div>}
    </div>
    {createOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"><div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between"><div><p className="text-xs font-bold uppercase tracking-wider text-blue-600">Create shipment</p><h2 className="mt-1 text-2xl font-black text-slate-900">Start picking from a reserved sale</h2></div><button type="button" onClick={() => setCreateOpen(false)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X size={18} /></button></div><label className="mt-5 block text-sm font-semibold text-slate-700">Reserved sale<select value={saleId} onChange={(event) => chooseSale(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm"><option value="">Choose sale</option>{sales.map((sale) => <option key={sale.id} value={sale.id}>{sale.number} · {sale.customer?.name ?? "Walk-in"} · {sale.warehouse?.name}</option>)}</select></label>{selectedSale && <><label className="mt-4 block text-sm font-semibold text-slate-700">Shipping address<textarea value={shippingAddress} onChange={(event) => setShippingAddress(event.target.value)} rows={2} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" /></label><div className="mt-4 space-y-2">{selectedSale.items.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3"><div><p className="font-semibold text-slate-800">{item.product.name}</p><p className="text-xs text-slate-500">{item.product.sku} · Ordered {item.quantity}</p></div><input type="number" min={0} max={item.quantity} value={quantities[item.id] ?? "0"} onChange={(event) => setQuantities((current) => ({ ...current, [item.id]: event.target.value }))} className="w-24 rounded-lg border border-slate-200 px-3 py-2 text-sm" /></div>)}</div></>}<div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setCreateOpen(false)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600">Cancel</button><button type="button" disabled={working === "create" || !selectedSale} onClick={() => void create()} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">{working === "create" && <LoaderCircle size={15} className="animate-spin" />}Create shipment</button></div></div></div>}
    {shippingId && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"><div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between"><div><p className="text-xs font-bold uppercase tracking-wider text-blue-600">Shipping hand-off</p><h2 className="mt-1 text-2xl font-black text-slate-900">Add courier details</h2></div><button type="button" onClick={() => setShippingId(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X size={18} /></button></div><label className="mt-5 block text-sm font-semibold text-slate-700">Courier<input value={courier} onChange={(event) => setCourier(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" placeholder="JNE, SiCepat, internal fleet..." /></label><label className="mt-3 block text-sm font-semibold text-slate-700">Tracking number<input value={trackingNumber} onChange={(event) => setTrackingNumber(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" placeholder="Resi / delivery note" /></label><div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setShippingId(null)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600">Cancel</button><button type="button" disabled={working === `ship:${shippingId}`} onClick={() => void ship()} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">{working === `ship:${shippingId}` && <LoaderCircle size={15} className="animate-spin" />}Confirm shipped</button></div></div></div>}
  </section>;
}

"use client";

import GlobalSelect from "@/components/ui/GlobalSelect";
import GlobalLoading from "@/components/ui/GlobalLoading";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Activity, AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Boxes, CalendarDays, Check, ChevronDown, Package, RefreshCw, Warehouse as WarehouseIcon } from "lucide-react";
import { apiRequest } from "@/lib/api";
import { useAuth } from "@/components/auth/AuthProvider";
import NotificationFeed from "@/components/dashboard/NotificationFeed";
import InventoryIntelligence from "@/components/dashboard/InventoryIntelligence";
import CostAndProfitPanel from "./CostAndProfitPanel";
import AttentionList from "@/components/dashboard/AttentionList";
import type { NotificationDestination } from "@/types/notification";
import type { Product } from "@/types/product";

type MasterRow = { id: string; name: string; code?: string; isActive: boolean; createdAt: string };
type DashboardPage = "categories" | "brands" | "units" | "products" | "warehouses";
type Point = { label: string; date: string; receipts: number; issues: number; adjustments: number; transfers: number };
type Segment = { label: string; count: number };
type DashboardSummary = {
  period?: { from: string; to: string; bucketDays: number };
  kpis: { purchaseValue: number; salesValue: number; expenseValue: number; stockUnits: number; lowStockLines: number; expiringUnits30d?: number; activeWarehouses?: number };
  monthly: Array<{ label: string; purchases: number; sales: number; expenses: number }>;
  trend?: Point[];
  operationStatus?: { purchases: Segment[]; sales: Segment[]; transfers: Segment[] };
  categoryStock?: Array<{ id: string; name: string; quantity: number }>;
  warehouses?: Array<{ id: string; name: string }>;
  topProducts: Array<{ id: string; sku: string; name: string; quantity: number; minStock: number }>;
  warehouseStock: Array<{ id: string; name: string; quantity: number; lines?: number }>;
  lowStock: Array<{ productId: string; sku: string; productName: string; warehouseId: string; warehouseName: string; quantityOnHand: number; minStock: number; reorderQuantity: number }>;
};
type Props = { products: Product[]; categories: MasterRow[]; brands: MasterRow[]; units: MasterRow[]; summary: DashboardSummary | null; loading: boolean; masterLoading: boolean; onNavigate: (page: DashboardPage) => void; onOpenAttention: (target: NotificationDestination) => void };

const colors = ["#2563eb", "#8b5cf6", "#10b981", "#f59e0b", "#ec4899", "#06b6d4", "#64748b"];
const money = (value: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value || 0);
const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const dateDaysAgo = (days: number) => localDate(new Date(Date.now() - days * 86_400_000));
const readableDate = (value: string) => value ? new Date(`${value}T12:00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : "—";
function normalizeSummary(value: Partial<DashboardSummary> | null | undefined): DashboardSummary | null {
  if (!value || typeof value !== "object") return null;
  return {
    ...value,
    kpis: { purchaseValue: 0, salesValue: 0, expenseValue: 0, stockUnits: 0, lowStockLines: 0, ...value.kpis },
    monthly: Array.isArray(value.monthly) ? value.monthly : [],
    trend: Array.isArray(value.trend) ? value.trend : [],
    operationStatus: {
      purchases: Array.isArray(value.operationStatus?.purchases) ? value.operationStatus.purchases : [],
      sales: Array.isArray(value.operationStatus?.sales) ? value.operationStatus.sales : [],
      transfers: Array.isArray(value.operationStatus?.transfers) ? value.operationStatus.transfers : [],
    },
    categoryStock: Array.isArray(value.categoryStock) ? value.categoryStock : [],
    warehouses: Array.isArray(value.warehouses) ? value.warehouses : [],
    topProducts: Array.isArray(value.topProducts) ? value.topProducts : [],
    warehouseStock: Array.isArray(value.warehouseStock) ? value.warehouseStock : [],
    lowStock: Array.isArray(value.lowStock) ? value.lowStock : [],
  } as DashboardSummary;
}

export default function DashboardView({ products, categories, brands, units, summary: initialSummary, loading, masterLoading, onNavigate, onOpenAttention }: Props) {
  const { user, can } = useAuth();
  const [remoteSummary, setRemoteSummary] = useState<DashboardSummary | null>(null);
  const summary = remoteSummary ?? normalizeSummary(initialSummary);
  const [from, setFrom] = useState(() => localDate(new Date(Date.now() - 29 * 86_400_000)));
  const [to, setTo] = useState(() => localDate(new Date()));
  const [appliedFrom, setAppliedFrom] = useState(() => localDate(new Date(Date.now() - 29 * 86_400_000)));
  const [appliedTo, setAppliedTo] = useState(() => localDate(new Date()));
  const [warehouseId, setWarehouseId] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [refreshing, setRefreshing] = useState(true);
  const [chartRevision, setChartRevision] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ from: appliedFrom, to: appliedTo });
    if (warehouseId) params.set("warehouseId", warehouseId);
    void apiRequest<{ success: boolean; data?: DashboardSummary; message?: string }>(`/api/operations/dashboard-summary?${params}`, { signal: controller.signal })
      .then((response) => { if (!controller.signal.aborted) { setRemoteSummary(normalizeSummary(response.data)); setChartRevision((revision) => revision + 1); setError(""); } })
      .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Dashboard data could not be loaded."); })
      .finally(() => { if (!controller.signal.aborted) setRefreshing(false); });
    return () => controller.abort();
  }, [appliedFrom, appliedTo, warehouseId]);

  const applyRange = (start = from, end = to) => {
    if (!start || !end || start > end) return;
    if (start === appliedFrom && end === appliedTo) return;
    setRefreshing(true);
    setAppliedFrom(start);
    setAppliedTo(end);
  };
  const applyPreset = (days: number) => {
    const end = localDate(new Date());
    const start = days === 0 ? `${end.slice(0, 8)}01` : dateDaysAgo(days - 1);
    setFrom(start);
    setTo(end);
    applyRange(start, end);
  };

  const catalog = [
    { label: "Categories", value: categories.length, page: "categories" as const },
    { label: "Brands", value: brands.length, page: "brands" as const },
    { label: "Units", value: units.length, page: "units" as const },
    { label: "Products", value: products.length, page: "products" as const },
  ];
  const composition = summary?.categoryStock ?? [];
  const totalComposition = composition.reduce((sum, row) => sum + row.quantity, 0);
  const maxWarehouse = Math.max(1, ...(summary?.warehouseStock ?? []).map((row) => row.quantity));
  const maxProduct = Math.max(1, ...(summary?.topProducts ?? []).map((row) => row.quantity));
  const activeTrend = summary?.trend ?? [];
  const trendLines = activeTrend;

  return <main className="space-y-5 pb-8">
    <header className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-emerald-800 via-green-700 to-lime-600 px-6 py-5 text-white shadow-lg sm:px-8">
      <div className="absolute -right-8 -top-24 h-72 w-72 rounded-full border-[36px] border-white/10" />
      <div className="relative flex flex-wrap items-center justify-between gap-5">
        <div><p className="text-xs font-semibold uppercase tracking-[.2em] text-green-100">StockFlow · {user?.role.name ?? "Inventory analytics"}</p><h2 className="mt-1 text-2xl font-bold sm:text-3xl">Inventory & Operations Dashboard</h2><p className="mt-1 text-sm text-green-50/90">Ringkasan pembelian, penjualan, pergerakan stok, dan kesehatan persediaan.</p></div>
        <button type="button" aria-expanded={filtersOpen} aria-controls="dashboard-date-filters" onClick={() => setFiltersOpen((open) => !open)} className="rounded-xl border border-white/25 bg-white/10 px-4 py-3 text-left text-sm font-semibold backdrop-blur transition hover:bg-white/20"><CalendarDays className="mr-2 inline" size={16} />{readableDate(appliedFrom)} – {readableDate(appliedTo)}<ChevronDown className={`ml-2 inline transition-transform ${filtersOpen ? "rotate-180" : ""}`} size={15} /><span className="mt-1 block text-xs font-normal text-green-50">Klik untuk {filtersOpen ? "menutup" : "mengatur"} periode</span></button>
      </div>
    </header>

    {filtersOpen && <section id="dashboard-date-filters" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Filter periode laporan</h3><p className="mt-1 text-xs text-slate-500">Pilih rentang tanggal. Data transaksi dihitung ulang setelah diterapkan.</p></div><div className="flex flex-wrap gap-2">{[{ label: "7 hari", days: 7 }, { label: "30 hari", days: 30 }, { label: "90 hari", days: 90 }, { label: "Bulan ini", days: 0 }].map((preset) => <button key={preset.label} type="button" onClick={() => applyPreset(preset.days)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">{preset.label}</button>)}</div></div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1.2fr_auto_auto]">
        <label className="text-xs font-semibold text-slate-500">Dari tanggal<input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" /></label>
        <label className="text-xs font-semibold text-slate-500">Sampai tanggal<input type="date" value={to} min={from || undefined} max={localDate(new Date())} onChange={(e) => setTo(e.target.value)} className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" /></label>
        <label className="text-xs font-semibold text-slate-500">Gudang<GlobalSelect value={warehouseId} onChange={(e) => { setWarehouseId(e.target.value); setRefreshing(true); }} className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"><option value="">Semua gudang yang diizinkan</option>{summary?.warehouses?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</GlobalSelect></label>
        <button type="button" disabled={!from || !to || from > to || (from === appliedFrom && to === appliedTo)} onClick={() => applyRange()} className="self-end rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"><Check size={15} className="mr-2 inline" />Terapkan</button>
        <button type="button" onClick={() => { const start = dateDaysAgo(29); const end = localDate(new Date()); setFrom(start); setTo(end); if (warehouseId || start !== appliedFrom || end !== appliedTo) setRefreshing(true); setWarehouseId(""); setAppliedFrom(start); setAppliedTo(end); }} className="self-end rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"><RefreshCw size={15} className="mr-2 inline" />Reset filter</button>
      </div>
      {from > to && <p role="alert" className="text-xs font-medium text-rose-600">Tanggal mulai harus sebelum atau sama dengan tanggal akhir.</p>}
      <p className="text-[11px] text-slate-400">Nilai pembelian, penjualan, biaya, tren, dan status transaksi mengikuti periode. Kartu stok/reorder menunjukkan saldo terkini.</p>
    </section>}
    {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">{error}</div>}

    {!summary && refreshing ? <section aria-label="Memuat ringkasan dashboard" aria-busy="true" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">{Array.from({ length: 6 }, (_, index) => <div key={index} className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900"><span className="sf-skeleton block h-3 w-2/3 rounded-full" /><span className="sf-skeleton mt-4 block h-6 w-1/2 rounded-lg" /><span className="sf-skeleton mt-3 block h-2 w-3/4 rounded-full" /></div>)}<span role="status" className="sr-only">Memuat ringkasan dashboard…</span></section> : <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
      <Kpi label="Nilai pembelian" value={can("purchases.read") ? money(summary?.kpis.purchaseValue ?? 0) : "Akses terbatas"} color="blue" note="PO non-cancelled" />
      <Kpi label="Penjualan selesai" value={can("sales.read") ? money(summary?.kpis.salesValue ?? 0) : "Akses terbatas"} color="green" note="Sale completed" />
      <Kpi label="Biaya operasional" value={can("expenses.read") ? money(summary?.kpis.expenseValue ?? 0) : "Akses terbatas"} color="rose" note="Periode terpilih" />
      <Kpi label="Stok tersedia" value={can("inventory.read") ? `${(summary?.kpis.stockUnits ?? 0).toLocaleString("id-ID")} unit` : "Akses terbatas"} color="violet" note="Lokasi dan batch layak, setelah reservasi" />
      <Kpi label="Perlu reorder" value={can("inventory.read") ? `${summary?.kpis.lowStockLines ?? 0} baris` : "Akses terbatas"} color="amber" note="Di bawah minimum" />
      <Kpi label="Segera kedaluwarsa" value={can("inventory.read") ? `${summary?.kpis.expiringUnits30d ?? 0} unit` : "Akses terbatas"} color="cyan" note="Batch dalam 30 hari" />
    </section>}

    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{catalog.map((item, i) => <button type="button" key={item.label} onClick={() => onNavigate(item.page)} className="group rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-slate-700 dark:bg-slate-900"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Master · {item.label}</span><span className="mt-2 flex items-end justify-between"><strong className="text-3xl text-slate-900 dark:text-white">{masterLoading || loading ? "—" : item.value}</strong><span className="h-2 w-16 rounded-full" style={{ background: colors[i] }} /></span><span className="mt-1 block text-xs text-slate-400">Terhubung ke katalog produk →</span></button>)}</section>

    <div key={chartRevision} className="sf-dashboard-charts space-y-4">
    <section className="grid gap-4 xl:grid-cols-[1.55fr_1fr]">
      <Panel title="Tren pergerakan stok" subtitle={`Penerimaan, issue, adjustment, dan transfer · bucket ${summary?.period?.bucketDays ?? 1} hari`} icon={<Activity className="text-blue-500" size={19} />}><MovementChart points={trendLines} /></Panel>
      <Panel title="Komposisi stok per kategori" subtitle="Jumlah available stock menurut Product → Category" icon={<Boxes className="text-violet-500" size={19} />}><Donut rows={composition.map((row) => ({ label: row.name, value: row.quantity }))} total={totalComposition} /></Panel>
    </section>

    <section className="grid gap-4 xl:grid-cols-3">
      <Panel title="Aktivitas transaksi" subtitle="Status PO, penjualan, dan transfer selama periode" icon={<ArrowDownToLine className="text-emerald-500" size={19} />}><div className="space-y-5">{([ ["Purchase", summary?.operationStatus?.purchases], ["Sales", summary?.operationStatus?.sales], ["Transfer", summary?.operationStatus?.transfers] ] as const).map(([name, rows]) => <StatusBars key={name} title={name} rows={rows ?? []} />)}</div></Panel>
      <Panel title="Stok per warehouse" subtitle="Available units; mengikuti warehouse scope akun" icon={<WarehouseIcon className="text-cyan-500" size={19} />}><div className="space-y-4">{summary?.warehouseStock.slice(0, 7).map((row) => <HorizontalBar key={row.id} label={row.name} value={row.quantity} max={maxWarehouse} color="#06b6d4" />)}{!summary?.warehouseStock.length && <Empty />}</div></Panel>
      <Panel title="Produk dengan stok terbanyak" subtitle="Saldo tersedia dari InventoryBalance" icon={<Package className="text-amber-500" size={19} />}><div className="space-y-4">{summary?.topProducts.slice(0, 7).map((row) => <HorizontalBar key={row.id} label={`${row.name} · ${row.sku}`} value={row.quantity} max={maxProduct} color="#f59e0b" />)}{!summary?.topProducts.length && <Empty />}</div></Panel>
    </section>

    <section className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
      <Panel title="Nilai aktivitas per bulan" subtitle="Nilai PO, sales selesai, dan expense (IDR)" icon={<ArrowUpFromLine className="text-indigo-500" size={19} />}><MonthlyBars rows={summary?.monthly ?? []} /></Panel>
      <Panel title="Antrian reorder" subtitle="Rekomendasi sederhana: target minimum × 2" icon={<AlertTriangle className="text-amber-500" size={19} />}><div className="max-h-64 space-y-2 overflow-auto">{summary?.lowStock.slice(0, 8).map((row) => <div key={`${row.productId}:${row.warehouseId}`} className="flex items-center justify-between gap-3 rounded-xl bg-amber-50/70 p-3 dark:bg-amber-950/20"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{row.productName}</p><p className="text-xs text-slate-500">{row.warehouseName} · {row.sku}</p></div><span className="shrink-0 rounded-lg bg-white px-2.5 py-1.5 text-xs font-bold text-amber-700 dark:bg-slate-900 dark:text-amber-300">{row.quantityOnHand}/{row.minStock} · +{row.reorderQuantity}</span></div>)}{!summary?.lowStock.length && <p className="py-8 text-center text-sm text-emerald-700 dark:text-emerald-300">Semua stok berada di atas minimum.</p>}</div></Panel>
    </section>
    </div>

    <section className="grid gap-4 xl:grid-cols-[1fr_1.2fr]"><Panel title="Kelengkapan katalog" subtitle="Relasi master data yang dipakai product" icon={<Boxes className="text-indigo-500" size={19} />}><div className="space-y-4">{[["Product → Category", products.filter((p) => Boolean(p.categoryId)).length, products.length], ["Product → Brand", products.filter((p) => Boolean(p.brandId)).length, products.length], ["Product → Unit", products.filter((p) => Boolean(p.unitId)).length, products.length], ["Barcode tersedia", products.filter((p) => Boolean(p.barcode)).length, products.length]].map(([label, value, total]) => <Progress key={String(label)} label={String(label)} value={Number(value)} total={Number(total)} />)}</div></Panel><Panel title="Pembaruan terbaru di katalog" subtitle="SKU, kategori, merek, dan saldo tersedia" icon={<Package className="text-blue-500" size={19} />}><div className="divide-y divide-slate-100 dark:divide-slate-800">{products.slice(0, 5).map((product) => <div key={product.id} className="flex items-center gap-3 py-3"><span className="rounded-xl bg-blue-50 p-2 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300"><Package size={17} /></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-slate-800 dark:text-slate-100">{product.name}</p><p className="truncate text-xs text-slate-500">{product.sku} · {product.category?.name ?? "Tanpa kategori"} · {product.brand?.name ?? "Tanpa brand"}</p></div><strong className="text-sm text-slate-800 dark:text-white">{product.totalStock ?? "—"}</strong></div>)}{!products.length && <Empty />}</div><button type="button" onClick={() => onNavigate("products")} className="mt-3 text-sm font-semibold text-blue-600 hover:text-blue-700">Buka katalog →</button></Panel></section>

    <div className="flex items-center justify-end">{refreshing && <GlobalLoading compact label="Memuat analitik…" />}</div>
    <CostAndProfitPanel key={`${appliedFrom}:${appliedTo}:${warehouseId}`} from={appliedFrom} to={appliedTo} warehouseId={warehouseId || undefined} />
    <AttentionList onOpen={onOpenAttention} /><NotificationFeed /><p className="text-xs text-slate-500 dark:text-slate-300">Valuasi WAC hanya mencakup modal yang tercatat; stok lama bermodal tidak diketahui ditampilkan terpisah. Saran pembelian tanpa izin membaca purchase tidak mencakup barang dalam perjalanan.</p><InventoryIntelligence />
  </main>;
}

function Panel({ title, subtitle, icon, children }: { title: string; subtitle: string; icon: ReactNode; children: ReactNode }) { return <article className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:p-6"><div className="mb-5 flex items-start justify-between gap-3"><div><h3 className="font-bold text-slate-900 dark:text-white">{title}</h3><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p></div>{icon}</div>{children}</article>; }
function Kpi({ label, value, note, color }: { label: string; value: string; note: string; color: string }) { const tone: Record<string, string> = { blue: "border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/40", green: "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40", rose: "border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40", violet: "border-violet-200 bg-violet-50 dark:border-violet-900 dark:bg-violet-950/40", amber: "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40", cyan: "border-cyan-200 bg-cyan-50 dark:border-cyan-900 dark:bg-cyan-950/40" }; return <div className={`min-w-0 rounded-2xl border p-4 ${tone[color]}`}><p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p><p className="mt-2 truncate text-xl font-extrabold text-slate-900 dark:text-white">{value}</p><p className="mt-1 truncate text-[10px] text-slate-500 dark:text-slate-400">{note}</p></div>; }
function Donut({ rows, total }: { rows: { label: string; value: number }[]; total: number }) { const positiveRows = rows.filter((row) => row.value > 0); const gradient = positiveRows.reduce<{ stops: string[]; offset: number }>((result, row, index) => { const end = result.offset + (total ? row.value / total * 100 : 0); return { stops: [...result.stops, `${colors[index % colors.length]} ${result.offset}% ${end}%`], offset: end }; }, { stops: [], offset: 0 }).stops.join(", "); return <div className="flex flex-wrap items-center gap-6"><div className="relative h-44 w-44 shrink-0 rounded-full" style={{ background: gradient ? `conic-gradient(${gradient})` : "#e2e8f0" }}><div className="absolute inset-8 flex flex-col items-center justify-center rounded-full bg-white dark:bg-slate-900"><b className="text-2xl text-slate-900 dark:text-white">{total.toLocaleString("id-ID")}</b><span className="text-[10px] uppercase text-slate-500">unit tersedia</span></div></div><div className="min-w-[150px] flex-1 space-y-2.5">{rows.slice(0, 7).map((row, i) => <div className="flex justify-between gap-3 text-xs" key={row.label}><span className="flex min-w-0 items-center gap-2 text-slate-600 dark:text-slate-300"><i className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colors[i % colors.length] }} /><span className="truncate">{row.label}</span></span><b className="shrink-0 text-slate-800 dark:text-white">{row.value.toLocaleString("id-ID")}</b></div>)}{!rows.length && <Empty />}</div></div>; }
function MovementChart({ points }: { points: Point[] }) { const width = 620; const height = 220; const pad = 28; const max = Math.max(1, ...points.flatMap((p) => [p.receipts, p.issues, p.adjustments, p.transfers])); const keys = [["receipts", "#10b981", "Receipt"], ["issues", "#2563eb", "Sale issue"], ["adjustments", "#f59e0b", "Adjustment"], ["transfers", "#8b5cf6", "Transfer"]] as const; const coord = (v: number, i: number) => ({ x: pad + i * (width - pad * 2) / Math.max(points.length - 1, 1), y: height - pad - v / max * (height - pad * 2) }); return <><div className="flex flex-wrap gap-x-4 gap-y-2 text-[10px] text-slate-500">{keys.map(([key, color, label]) => <span key={key}><i className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: color }} />{label}</span>)}</div><svg viewBox={`0 0 ${width} ${height}`} className="mt-3 h-56 w-full" role="img" aria-label="Tren pergerakan stok"><defs><linearGradient id="movement-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#2563eb" stopOpacity=".16"/><stop offset="1" stopColor="#2563eb" stopOpacity="0"/></linearGradient></defs>{[0, 1, 2, 3].map((i) => <line key={i} x1={pad} x2={width - pad} y1={pad + i * (height - 2 * pad) / 3} y2={pad + i * (height - 2 * pad) / 3} stroke="currentColor" className="text-slate-100 dark:text-slate-800" strokeDasharray="4 5"/>)}{keys.map(([key, color]) => { const coords = points.map((p, i) => coord(p[key], i)); const path = coords.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" "); return <g key={key}><path d={path} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>{coords.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="3" fill={color}><title>{points[i].label}: {points[i][key]}</title></circle>)}</g>; })}{points.map((p, i) => i % Math.max(1, Math.ceil(points.length / 7)) === 0 || i === points.length - 1 ? <text key={p.date} x={coord(0, i).x} y={height - 4} textAnchor="middle" className="fill-slate-400 text-[10px]">{p.label}</text> : null)}</svg>{!points.length && <Empty />}</>; }
function StatusBars({ title, rows }: { title: string; rows: Segment[] }) { const max = Math.max(1, ...rows.map((r) => r.count)); return <div><p className="mb-2 text-xs font-bold text-slate-700 dark:text-slate-200">{title}</p><div className="space-y-2">{rows.slice(0, 4).map((r, i) => <div key={r.label} className="flex items-center gap-2 text-[10px]"><span className="w-24 truncate text-slate-500">{r.label.replaceAll("_", " ")}</span><div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full rounded-full" style={{ width: `${r.count / max * 100}%`, background: colors[i] }} /></div><b className="w-6 text-right text-slate-700 dark:text-slate-200">{r.count}</b></div>)}{!rows.length && <p className="text-xs text-slate-400">Belum ada transaksi.</p>}</div></div>; }
function HorizontalBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) { return <div><div className="mb-1 flex items-center justify-between gap-3 text-xs"><span className="truncate text-slate-600 dark:text-slate-300">{label}</span><b className="shrink-0 text-slate-800 dark:text-white">{value.toLocaleString("id-ID")}</b></div><div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full rounded-full" style={{ width: `${Math.max(value ? 2 : 0, value / max * 100)}%`, background: color }} /></div></div>; }
function MonthlyBars({ rows }: { rows: DashboardSummary["monthly"] }) { const max = Math.max(1, ...rows.flatMap((r) => [r.purchases, r.sales, r.expenses])); return <div className="grid grid-cols-6 gap-2 sm:grid-cols-12">{rows.map((r) => <div key={r.label} className="min-w-0 text-center"><div className="flex h-36 items-end justify-center gap-0.5 rounded-lg bg-slate-50 px-1 pb-1 dark:bg-slate-950/60"><div className="w-1/3 rounded-t bg-blue-500" style={{ height: `${Math.max(r.purchases ? 3 : 0, r.purchases / max * 100)}%` }} title={`Purchase ${money(r.purchases)}`}/><div className="w-1/3 rounded-t bg-emerald-500" style={{ height: `${Math.max(r.sales ? 3 : 0, r.sales / max * 100)}%` }} title={`Sales ${money(r.sales)}`}/><div className="w-1/3 rounded-t bg-rose-400" style={{ height: `${Math.max(r.expenses ? 3 : 0, r.expenses / max * 100)}%` }} title={`Expense ${money(r.expenses)}`}/></div><span className="mt-1 block truncate text-[10px] text-slate-500">{r.label}</span></div>)}<div className="col-span-full mt-2 flex gap-4 text-[10px] text-slate-500"><span>■ Pembelian</span><span className="text-emerald-600">■ Sales</span><span className="text-rose-500">■ Expense</span></div>{!rows.length && <Empty />}</div>; }
function Progress({ label, value, total }: { label: string; value: number; total: number }) { const pct = total ? Math.round(value / total * 100) : 0; return <div><div className="mb-1.5 flex justify-between text-xs"><span className="text-slate-600 dark:text-slate-300">{label}</span><b className="text-slate-800 dark:text-white">{pct}% <span className="font-normal text-slate-400">({value}/{total})</span></b></div><div className="h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-violet-500" style={{ width: `${pct}%` }}/></div></div>; }
function Empty() { return <p className="py-8 text-center text-sm text-slate-400">Belum ada data untuk ditampilkan.</p>; }

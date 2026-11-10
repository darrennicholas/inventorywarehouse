"use client";

import GlobalSelect from "@/components/ui/GlobalSelect";
import GlobalLoading from "@/components/ui/GlobalLoading";
import { useAuth } from "@/components/auth/AuthProvider";
import { apiRequest } from "@/lib/api";
import { statusLabel } from "@/lib/ui-labels";
import { Activity, Boxes, Check, LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

type Point = { label: string; date: string; receipts: number; issues: number; adjustments: number; transfers: number };
type Segment = { label: string; count: number };
type MonthlySeries = "purchases" | "sales" | "expenses";
type DashboardSummary = {
  period?: { from: string; to: string; bucketDays: number };
  kpis?: { purchaseValue: number; salesValue: number; expenseValue: number; stockUnits: number; lowStockLines: number; expiringUnits30d: number; activeWarehouses: number };
  monthly: Array<{ label: string; purchases: number; sales: number; expenses: number }>;
  trend: Point[];
  operationStatus: { purchases: Segment[]; sales: Segment[]; transfers: Segment[] };
  categoryStock: Array<{ id: string; name: string; quantity: number }>;
  warehouses: Array<{ id: string; name: string }>;
};

const colors = ["#2563eb", "#10b981", "#f43f5e", "#8b5cf6", "#f59e0b", "#06b6d4", "#64748b"];
const money = (value: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value || 0);
const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const dateDaysAgo = (days: number) => localDate(new Date(Date.now() - days * 86_400_000));
const readableDate = (value: string) => value ? new Date(`${value}T12:00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : "—";

function normalizeSummary(value: Partial<DashboardSummary> | null | undefined): DashboardSummary | null {
  if (!value || typeof value !== "object") return null;
  return {
    ...value,
    monthly: Array.isArray(value.monthly) ? value.monthly : [],
    trend: Array.isArray(value.trend) ? value.trend : [],
    operationStatus: {
      purchases: Array.isArray(value.operationStatus?.purchases) ? value.operationStatus.purchases : [],
      sales: Array.isArray(value.operationStatus?.sales) ? value.operationStatus.sales : [],
      transfers: Array.isArray(value.operationStatus?.transfers) ? value.operationStatus.transfers : [],
    },
    categoryStock: Array.isArray(value.categoryStock) ? value.categoryStock : [],
    warehouses: Array.isArray(value.warehouses) ? value.warehouses : [],
  } as DashboardSummary;
}

export default function DashboardView() {
  const { can } = useAuth();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [from, setFrom] = useState(() => dateDaysAgo(29));
  const [to, setTo] = useState(() => localDate(new Date()));
  const [appliedFrom, setAppliedFrom] = useState(() => dateDaysAgo(29));
  const [appliedTo, setAppliedTo] = useState(() => localDate(new Date()));
  const [warehouseId, setWarehouseId] = useState("");
  const [appliedWarehouseId, setAppliedWarehouseId] = useState("");
  const [refreshing, setRefreshing] = useState(true);
  const [applyingFilters, setApplyingFilters] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ from: appliedFrom, to: appliedTo });
    if (appliedWarehouseId) params.set("warehouseId", appliedWarehouseId);
    void apiRequest<{ success: boolean; data?: DashboardSummary; message?: string }>(`/api/operations/dashboard-summary?${params}`, { signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted) return;
        setSummary(normalizeSummary(response.data));
        setError("");
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Data dashboard tidak dapat dimuat.");
      })
      .finally(() => { if (!controller.signal.aborted) { setRefreshing(false); setApplyingFilters(false); } });
    return () => controller.abort();
  }, [appliedFrom, appliedTo, appliedWarehouseId]);

  const applyRange = (start = from, end = to, warehouse = warehouseId) => {
    if (!start || !end || start > end) return;
    if (start === appliedFrom && end === appliedTo && warehouse === appliedWarehouseId) return;
    setError("");
    setRefreshing(true);
    setApplyingFilters(true);
    setAppliedFrom(start);
    setAppliedTo(end);
    setAppliedWarehouseId(warehouse);
  };

  const applyPreset = (days: number) => {
    const end = localDate(new Date());
    const start = days === 0 ? `${end.slice(0, 8)}01` : dateDaysAgo(days - 1);
    setFrom(start);
    setTo(end);
    applyRange(start, end, warehouseId);
  };

  const resetFilters = () => {
    const start = dateDaysAgo(29);
    const end = localDate(new Date());
    setFrom(start);
    setTo(end);
    setWarehouseId("");
    applyRange(start, end, "");
  };

  const hasChanges = from !== appliedFrom || to !== appliedTo || warehouseId !== appliedWarehouseId;
  const financialSeries = [
    ...(can("purchases.read") ? [{ key: "purchases" as const, label: "Pembelian", color: colors[0] }] : []),
    ...(can("sales.read") ? [{ key: "sales" as const, label: "Penjualan", color: colors[1] }] : []),
    ...(can("expenses.read") ? [{ key: "expenses" as const, label: "Biaya", color: colors[2] }] : []),
  ];
  const statusGroups = [
    ...(can("purchases.read") ? [{ title: "Pembelian", rows: summary?.operationStatus.purchases ?? [] }] : []),
    ...(can("sales.read") ? [{ title: "Penjualan", rows: summary?.operationStatus.sales ?? [] }] : []),
    ...(can("transfers.read") ? [{ title: "Transfer", rows: summary?.operationStatus.transfers ?? [] }] : []),
  ];
  const canViewInventory = can("inventory.read");
  const canViewStatus = statusGroups.length > 0;
  const hasCharts = canViewInventory || financialSeries.length > 0 || canViewStatus;
  const dashboardMetrics = [
    ...(canViewInventory ? [
      { key: "stock", label: "Total stok tersedia", value: (summary?.kpis?.stockUnits ?? 0).toLocaleString("id-ID"), note: "Di gudang yang dapat diakses", icon: <Boxes size={18} />, tone: "blue" },
      { key: "low-stock", label: "Perlu restok", value: (summary?.kpis?.lowStockLines ?? 0).toLocaleString("id-ID"), note: "Baris stok di bawah minimum", icon: <Activity size={18} />, tone: "amber" },
    ] : []),
    ...(can("warehouses.read") ? [{ key: "warehouses", label: "Gudang aktif", value: String(summary?.kpis?.activeWarehouses ?? summary?.warehouses.length ?? 0), note: "Sesuai cakupan akses role", icon: <Boxes size={18} />, tone: "violet" }] : []),
    ...(can("purchases.read") ? [{ key: "purchases", label: "Nilai pembelian", value: money(summary?.kpis?.purchaseValue ?? 0), note: "Pada periode terpilih", icon: <Activity size={18} />, tone: "blue" }] : []),
    ...(can("sales.read") ? [{ key: "sales", label: "Nilai penjualan", value: money(summary?.kpis?.salesValue ?? 0), note: "Pada periode terpilih", icon: <Activity size={18} />, tone: "green" }] : []),
    ...(can("expenses.read") ? [{ key: "expenses", label: "Total biaya", value: money(summary?.kpis?.expenseValue ?? 0), note: "Pada periode terpilih", icon: <Activity size={18} />, tone: "rose" }] : []),
  ].slice(0, 4);

  return <div className="sf-dashboard mx-auto max-w-[1320px] space-y-4 pb-8">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div><p className="text-[11px] font-bold uppercase tracking-[.16em] text-blue-600">StockFlow · Ringkasan operasional</p><h1 className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">Dashboard</h1><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Pantau aktivitas sesuai menu dan gudang yang dapat Anda akses.</p></div>
      <p className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">{readableDate(appliedFrom)} – {readableDate(appliedTo)}</p>
    </header>

    {dashboardMetrics.length > 0 && <section aria-label="Ringkasan dashboard" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {dashboardMetrics.map((metric) => <article key={metric.key} className={`sf-dashboard-metric sf-metric-${metric.tone} min-w-0 rounded-2xl border p-4 shadow-sm`}>
        <div className="flex items-center justify-between gap-3"><p className="truncate text-xs font-semibold text-slate-600 dark:text-slate-300">{metric.label}</p><span className="sf-metric-icon flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">{metric.icon}</span></div>
        <p className="mt-3 truncate text-xl font-bold tracking-tight text-slate-900 dark:text-white" title={metric.value}>{summary ? metric.value : "—"}</p>
        <p className="mt-1 truncate text-[11px] text-slate-500 dark:text-slate-400">{metric.note}</p>
      </article>)}
    </section>}

    <section aria-label="Filter dashboard" className="sf-filter-toolbar rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">Filter data</h2><div className="flex flex-wrap gap-1.5">{[{ label: "7 hari", days: 7 }, { label: "30 hari", days: 30 }, { label: "90 hari", days: 90 }, { label: "Bulan ini", days: 0 }].map((preset) => <button key={preset.label} type="button" onClick={() => applyPreset(preset.days)} disabled={refreshing} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-wait disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">{preset.label}</button>)}</div></div>
      <div className="grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(150px,1fr)_minmax(150px,1fr)_minmax(190px,1.2fr)_auto_auto]">
        <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">Dari tanggal<input type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} className="mt-1 block min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" /></label>
        <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">Sampai tanggal<input type="date" value={to} min={from || undefined} max={localDate(new Date())} onChange={(event) => setTo(event.target.value)} className="mt-1 block min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" /></label>
        <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">Gudang<GlobalSelect value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)} className="mt-1 block min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"><option value="">Semua gudang yang diizinkan</option>{summary?.warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</GlobalSelect></label>
        <button type="button" disabled={!hasChanges || !from || !to || from > to || refreshing} onClick={() => applyRange()} className="inline-flex min-h-10 w-fit items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-45">{applyingFilters ? <><LoaderCircle size={15} className="animate-spin" aria-hidden="true" />Menerapkan...</> : <><Check size={15} aria-hidden="true" />Terapkan</>}</button>
        <button type="button" disabled={refreshing} onClick={resetFilters} className="inline-flex min-h-10 w-fit items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:border-blue-200 hover:bg-blue-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"><RefreshCw size={15} aria-hidden="true" />Reset</button>
      </div>
      {from && to && from > to && <p role="alert" className="mt-2 text-xs font-medium text-rose-600">Tanggal awal harus sebelum atau sama dengan tanggal akhir.</p>}
      {error && <p role="alert" className="mt-2 text-xs font-medium text-rose-600">{error}</p>}
    </section>

    {hasCharts && !summary && refreshing && <section aria-label="Memuat grafik dashboard" aria-busy="true" className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900"><GlobalLoading label="Memuat grafik dashboard..." /></section>}
    {hasCharts && (summary || !refreshing) && <section aria-label="Grafik dashboard" aria-busy={refreshing} className={`sf-dashboard-charts grid gap-4 xl:grid-cols-2 ${refreshing && summary ? "opacity-60" : ""}`}>
      {financialSeries.length > 0 && <Panel title="Nilai transaksi per bulan" icon={<Boxes className="text-blue-500" size={18} />}><MonthlyBars rows={summary?.monthly ?? []} series={financialSeries} /></Panel>}
      {canViewInventory && <Panel title="Pergerakan stok" icon={<Activity className="text-emerald-500" size={18} />}><MovementChart points={summary?.trend ?? []} bucketDays={summary?.period?.bucketDays ?? 1} /></Panel>}
      {canViewInventory && <Panel title="Komposisi stok · kategori utama"><Donut rows={summary?.categoryStock.map((row) => ({ label: row.name, value: row.quantity })) ?? []} /></Panel>}
      {canViewStatus && <Panel title="Status transaksi"><div className="grid gap-4 sm:grid-cols-3">{statusGroups.map((group) => <StatusBars key={group.title} title={group.title} rows={group.rows} />)}</div></Panel>}
    </section>}
    {!hasCharts && <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900">Tidak ada grafik yang tersedia untuk role ini.</p>}
  </div>;
}

function Panel({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return <article className="sf-dashboard-panel min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:p-5"><div className="mb-3 flex items-center justify-between gap-3"><h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">{title}</h3>{icon}</div>{children}</article>;
}

function Donut({ rows }: { rows: { label: string; value: number }[] }) {
  const positiveRows = rows.filter((row) => row.value > 0).slice(0, colors.length);
  const total = positiveRows.reduce((sum, row) => sum + row.value, 0);
  const gradient = positiveRows.reduce<{ stops: string[]; offset: number }>((result, row, index) => {
    const end = result.offset + (total ? row.value / total * 100 : 0);
    return { stops: [...result.stops, `${colors[index % colors.length]} ${result.offset}% ${end}%`], offset: end };
  }, { stops: [], offset: 0 }).stops.join(", ");
  if (!total) return <ChartEmpty />;
  return <div className="flex flex-wrap items-center justify-center gap-5 sm:justify-start"><div role="img" aria-label={`Komposisi ${positiveRows.length} kategori utama, total ${total.toLocaleString("id-ID")} unit pada kategori yang ditampilkan`} className="relative h-36 w-36 shrink-0 rounded-full" style={{ background: `conic-gradient(${gradient})` }}><div className="absolute inset-7 flex flex-col items-center justify-center rounded-full bg-white dark:bg-slate-900"><b className="text-xl text-slate-900 dark:text-white">{total.toLocaleString("id-ID")}</b><span className="text-[10px] text-slate-500">unit · kategori utama</span></div></div><div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-2">{positiveRows.map((row, index) => <div className="flex min-w-0 items-center gap-2 text-xs" key={row.label}><i className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colors[index % colors.length] }} /><span className="truncate text-slate-600 dark:text-slate-300">{row.label}</span><b className="ml-auto shrink-0 text-slate-800 dark:text-white">{row.value.toLocaleString("id-ID")}</b></div>)}</div></div>;
}

function MovementChart({ points, bucketDays }: { points: Point[]; bucketDays: number }) {
  const width = 620; const height = 200; const pad = 26;
  const keys = [["receipts", "#10b981", "Masuk"], ["issues", "#2563eb", "Keluar"], ["adjustments", "#f59e0b", "Penyesuaian"], ["transfers", "#8b5cf6", "Transfer"]] as const;
  const max = Math.max(1, ...points.flatMap((point) => [point.receipts, point.issues, point.adjustments, point.transfers]));
  const coordinate = (value: number, index: number) => ({ x: pad + index * (width - pad * 2) / Math.max(points.length - 1, 1), y: height - pad - value / max * (height - pad * 2) });
  if (!points.length) return <ChartEmpty />;
  return <div><div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-500">{keys.map(([key, color, label]) => <span key={key}><i className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: color }} />{label}</span>)}</div><svg viewBox={`0 0 ${width} ${height}`} className="mt-2 h-44 w-full" role="img" aria-label={`Grafik pergerakan stok, satu titik setiap ${bucketDays} hari`}><title>Pergerakan stok</title>{[0, 1, 2, 3].map((index) => <line key={index} x1={pad} x2={width - pad} y1={pad + index * (height - pad * 2) / 3} y2={pad + index * (height - pad * 2) / 3} stroke="currentColor" className="text-slate-100 dark:text-slate-800" strokeDasharray="4 5" />)}{keys.map(([key, color, label]) => { const coordinates = points.map((point, index) => coordinate(point[key], index)); const path = coordinates.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" "); return <g key={key}><path d={path} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />{coordinates.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r="2.5" fill={color}><title>{points[index].label} · {label}: {points[index][key]}</title></circle>)}</g>; })}{points.map((point, index) => index % Math.max(1, Math.ceil(points.length / 7)) === 0 || index === points.length - 1 ? <text key={point.date} x={coordinate(0, index).x} y={height - 3} textAnchor="middle" className="fill-slate-400 text-[10px]">{point.label}</text> : null)}</svg></div>;
}

function MonthlyBars({ rows, series }: { rows: DashboardSummary["monthly"]; series: { key: MonthlySeries; label: string; color: string }[] }) {
  const max = Math.max(1, ...rows.flatMap((row) => series.map(({ key }) => row[key])));
  if (!rows.length) return <ChartEmpty />;
  return <div><div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-500">{series.map((item) => <span key={item.key}><i className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: item.color }} />{item.label}</span>)}</div><div role="img" aria-label="Grafik nilai transaksi per bulan" className="mt-3 grid grid-cols-6 gap-2 sm:grid-cols-12">{rows.map((row) => <div key={row.label} className="min-w-0 text-center"><div className="flex h-32 items-end justify-center gap-0.5 rounded-lg bg-slate-50 px-1 pb-1 dark:bg-slate-950/60">{series.map((item) => <div key={item.key} className="w-1/3 rounded-t" style={{ height: `${Math.max(row[item.key] ? 3 : 0, row[item.key] / max * 100)}%`, background: item.color }} title={`${item.label}: ${money(row[item.key])}`} />)}</div><span className="mt-1 block truncate text-[10px] text-slate-500">{row.label}</span></div>)}</div></div>;
}

function StatusBars({ title, rows }: { title: string; rows: Segment[] }) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return <div className="min-w-0"><p className="mb-2 text-xs font-semibold text-slate-600 dark:text-slate-300">{title}</p>{rows.length ? <div className="space-y-2">{rows.slice(0, 5).map((row, index) => <div key={row.label} className="flex items-center gap-2 text-[10px]"><span className="w-24 shrink-0 truncate text-slate-500">{statusLabel(row.label)}</span><div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full rounded-full" style={{ width: `${row.count / max * 100}%`, background: colors[index] }} /></div><b className="w-6 text-right text-slate-700 dark:text-slate-200">{row.count}</b></div>)}</div> : <ChartEmpty compact />}</div>;
}

function ChartEmpty({ compact = false }: { compact?: boolean }) {
  return <p className={`text-center text-xs text-slate-400 ${compact ? "py-3" : "py-12"}`}>Belum ada data pada periode ini.</p>;
}

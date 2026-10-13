"use client";

import type { ReactNode } from "react";
import { AlertTriangle, ArrowRight, BarChart3, Boxes, ChartNoAxesCombined, Package, PieChart, Ruler, Tag, TrendingUp, Warehouse } from "lucide-react";
import type { Product } from "@/types/product";

type MasterRow = { id: string; name: string; code?: string; isActive: boolean; createdAt: string };
type DashboardPage = "categories" | "brands" | "units" | "products" | "warehouses";
type Props = { products: Product[]; categories: MasterRow[]; brands: MasterRow[]; units: MasterRow[]; loading: boolean; masterLoading: boolean; onNavigate: (page: DashboardPage) => void };

const colors = ["#3b82f6", "#8b5cf6", "#f59e0b", "#10b981", "#ec4899", "#06b6d4"];

function percentage(part: number, total: number) {
  return total ? Math.round((part / total) * 100) : 0;
}

function monthSeries(products: Product[]) {
  const now = new Date();
  return Array.from({ length: 6 }, (_, index) => {
    const month = new Date(now.getFullYear(), now.getMonth() - 5 + index, 1);
    const count = products.filter((product) => {
      const createdAt = new Date(product.createdAt);
      return createdAt.getFullYear() === month.getFullYear() && createdAt.getMonth() === month.getMonth();
    }).length;
    return { label: month.toLocaleDateString("id-ID", { month: "short" }), count };
  });
}

export default function DashboardView({ products, categories, brands, units, loading, masterLoading, onNavigate }: Props) {
  const counts = [
    { label: "Categories", value: categories.length, icon: Tag, color: "from-blue-500 to-indigo-600", page: "categories" as const },
    { label: "Brands", value: brands.length, icon: Boxes, color: "from-violet-500 to-fuchsia-600", page: "brands" as const },
    { label: "Units", value: units.length, icon: Ruler, color: "from-amber-500 to-orange-600", page: "units" as const },
    { label: "Products", value: products.length, icon: Package, color: "from-emerald-500 to-teal-600", page: "products" as const },
  ];
  const stockVisible = products.filter((product) => product.totalStock !== null);
  const lowStock = stockVisible.filter((product) => Number(product.totalStock) <= product.minStock);
  const categoryMap = products.reduce<Record<string, number>>((result, product) => {
    const label = product.category?.name ?? "Uncategorized";
    return { ...result, [label]: (result[label] ?? 0) + 1 };
  }, {});
  const categoryEntries = Object.entries(categoryMap).sort(([, left], [, right]) => right - left).slice(0, 5);
  const categoryTotal = categoryEntries.reduce((total, [, value]) => total + value, 0) || 1;
  const pieStops = categoryEntries.reduce<{ segments: string[]; offset: number }>((result, [, value], index) => {
    const end = result.offset + (value / categoryTotal) * 100;
    return { segments: [...result.segments, `${colors[index % colors.length]} ${result.offset}% ${end}%`], offset: end };
  }, { segments: [], offset: 0 }).segments.join(", ");
  const stockBars = [...stockVisible].sort((left, right) => Number(right.totalStock) - Number(left.totalStock)).slice(0, 6);
  const maxStock = Math.max(...stockBars.map((product) => Number(product.totalStock)), 1);
  const registrations = monthSeries(products);
  const maxRegistration = Math.max(...registrations.map((item) => item.count), 1);
  const linkedCategory = products.filter((product) => Boolean(product.categoryId)).length;
  const linkedBrand = products.filter((product) => Boolean(product.brandId)).length;
  const linkedUnit = products.filter((product) => Boolean(product.unitId)).length;
  const barcodeReady = products.filter((product) => Boolean(product.barcode)).length;
  const relationshipProgress = [
    { label: "Category linked", value: percentage(linkedCategory, products.length), color: "bg-blue-500" },
    { label: "Brand linked", value: percentage(linkedBrand, products.length), color: "bg-violet-500" },
    { label: "Unit linked", value: percentage(linkedUnit, products.length), color: "bg-amber-500" },
    { label: "Barcode ready", value: percentage(barcodeReady, products.length), color: "bg-emerald-500" },
  ];

  return <section className="space-y-6">
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#172b63] via-[#254ac2] to-[#5b45e8] p-6 text-white shadow-xl sm:p-8"><div className="absolute -right-20 -top-24 h-64 w-64 rounded-full border-[34px] border-white/10" /><div className="absolute bottom-[-80px] right-[30%] h-48 w-48 rounded-full bg-white/10" /><div className="relative flex flex-wrap items-end justify-between gap-6"><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-100">StockFlow Analytics</p><h2 className="mt-3 text-3xl font-bold tracking-tight">Inventory intelligence</h2><p className="mt-2 max-w-xl text-sm leading-6 text-blue-100">Four analytical views drawn from your product catalog, its master-data relations, inventory balances, and registration dates.</p></div><div className="rounded-2xl bg-white/15 p-4 backdrop-blur"><TrendingUp size={34} /></div></div></div>

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{counts.map((item) => { const Icon = item.icon; return <button key={item.label} type="button" onClick={() => onNavigate(item.page)} className="group rounded-2xl border border-slate-100 bg-white p-5 text-left shadow-sm transition hover:-translate-y-1 hover:shadow-lg dark:border-slate-800 dark:bg-slate-900"><div className="flex items-center justify-between"><span className={`flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${item.color} text-white shadow-md`}><Icon size={20} /></span><ArrowRight size={17} className="text-slate-300 transition group-hover:translate-x-1 group-hover:text-blue-500" /></div><p className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-400">{item.label}</p><p className="mt-1 text-3xl font-bold text-slate-900 dark:text-white">{masterLoading || loading ? "—" : item.value}</p><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Master records available</p></button>; })}</div>

    <div className="grid gap-6 xl:grid-cols-2">
      <ChartCard title="Product mix by category" subtitle="Pie chart · Product.categoryId and Category.name" icon={<PieChart size={20} className="text-blue-500" />}><div className="flex flex-wrap items-center gap-7"><div className="relative h-44 w-44 shrink-0 rounded-full" style={{ background: pieStops ? `conic-gradient(${pieStops})` : "#26354d" }}><div className="absolute inset-8 flex flex-col items-center justify-center rounded-full bg-white dark:bg-slate-900"><span className="text-3xl font-bold text-slate-900 dark:text-white">{products.length}</span><span className="text-[10px] uppercase tracking-wide text-slate-400">products</span></div></div><div className="min-w-[160px] flex-1 space-y-3">{categoryEntries.map(([label, value], index) => <div key={label} className="flex items-center justify-between gap-3 text-xs"><span className="flex min-w-0 items-center gap-2 text-slate-600 dark:text-slate-300"><span className="h-2.5 w-2.5 rounded-full" style={{ background: colors[index % colors.length] }} /><span className="truncate">{label}</span></span><span className="font-bold text-slate-900 dark:text-white">{value} · {percentage(value, categoryTotal)}%</span></div>)}{categoryEntries.length === 0 && <EmptyChart />}</div></div></ChartCard>

      <ChartCard title="Top stock by product" subtitle="Bar chart · Product.totalStock from InventoryBalance" icon={<BarChart3 size={20} className="text-emerald-500" />}><div className="mt-2 flex h-52 items-end gap-3 border-b border-l border-slate-200 px-4 pb-7 pt-4 dark:border-slate-700">{stockBars.map((product, index) => <div key={product.id} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2"><span className="text-[10px] font-bold text-slate-500">{product.totalStock}</span><div className="w-full max-w-10 rounded-t-lg transition-all" style={{ height: `${Math.max((Number(product.totalStock) / maxStock) * 100, 4)}%`, background: colors[index % colors.length] }} title={`${product.name}: ${product.totalStock}`} /><span className="w-full truncate text-center text-[10px] text-slate-500">{product.sku}</span></div>)}{stockBars.length === 0 && <EmptyChart />}</div></ChartCard>

      <ChartCard title="Product registration trend" subtitle="Line chart · Product.createdAt, last 6 months" icon={<ChartNoAxesCombined size={20} className="text-violet-500" />}><LineChart points={registrations.map((item) => item.count)} labels={registrations.map((item) => item.label)} maxValue={maxRegistration} /></ChartCard>

      <ChartCard title="Catalog relationship readiness" subtitle="Progress chart · Product categoryId, brandId, unitId, barcode" icon={<Warehouse size={20} className="text-amber-500" />}><div className="mt-6 space-y-5">{relationshipProgress.map((item) => <div key={item.label}><div className="mb-2 flex items-center justify-between text-xs"><span className="font-semibold text-slate-600 dark:text-slate-300">{item.label}</span><span className="font-bold text-slate-900 dark:text-white">{item.value}%</span></div><div className="h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className={`h-full rounded-full ${item.color} transition-all duration-700`} style={{ width: `${item.value}%` }} /></div></div>)}<div className="mt-5 rounded-xl bg-amber-50 p-3 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-200">{lowStock.length} products are at or below their Product.minStock threshold.</div></div></ChartCard>
    </div>

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Insight label="Stock visibility" value={`${stockVisible.length}`} hint="Products with inventory balances" tone="blue" /><Insight label="Low-stock attention" value={`${lowStock.length}`} hint="Using totalStock and minStock" tone="amber" icon={<AlertTriangle size={17} />} /><Insight label="Catalog linked" value={`${percentage(linkedCategory + linkedBrand + linkedUnit, products.length * 3)}%`} hint="Across three master relationships" tone="violet" /><Insight label="Barcode coverage" value={`${percentage(barcodeReady, products.length)}%`} hint="Products ready for scanning" tone="emerald" /></div>

    <div className="overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"><div className="flex items-center justify-between border-b border-slate-100 p-6 dark:border-slate-800"><div><h3 className="font-bold text-slate-900 dark:text-white">Latest product catalog</h3><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Recent records connected to category, brand and unit.</p></div><button type="button" onClick={() => onNavigate("products")} className="text-xs font-bold text-blue-600 hover:text-blue-700">View catalog <ArrowRight size={14} className="ml-1 inline" /></button></div><div className="divide-y divide-slate-100 dark:divide-slate-800">{loading && <div className="p-8 text-center text-sm text-slate-400">Loading products...</div>}{!loading && products.slice(0, 5).map((product) => <div key={product.id} className="flex items-center gap-4 px-6 py-4"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-300"><Package size={18} /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-slate-800 dark:text-slate-100">{product.name}</p><p className="mt-1 text-xs text-slate-400">{product.sku} · {product.category?.name ?? "Uncategorized"} · {product.brand?.name ?? "No brand"}</p></div><div className="hidden text-right sm:block"><p className="text-sm font-bold text-slate-800 dark:text-slate-100">{product.totalStock ?? "—"}</p><p className="text-[10px] uppercase tracking-wide text-slate-400">Stock</p></div></div>)}{!loading && products.length === 0 && <div className="p-8 text-center text-sm text-slate-400">No products available.</div>}</div></div>
  </section>;
}

function ChartCard({ title, subtitle, icon, children }: { title: string; subtitle: string; icon: ReactNode; children: ReactNode }) {
  return <article className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"><div className="flex items-start justify-between gap-4"><div><h3 className="font-bold text-slate-900 dark:text-white">{title}</h3><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p></div>{icon}</div><div className="mt-5">{children}</div></article>;
}

function LineChart({ points, labels, maxValue }: { points: number[]; labels: string[]; maxValue: number }) {
  const width = 520; const height = 190; const padX = 28; const padY = 28;
  const coordinates = points.map((point, index) => ({ x: padX + (index * (width - padX * 2)) / Math.max(points.length - 1, 1), y: height - padY - (point / maxValue) * (height - padY * 2), point }));
  const path = coordinates.map((coordinate, index) => `${index === 0 ? "M" : "L"}${coordinate.x},${coordinate.y}`).join(" ");
  const area = `${path} L ${coordinates.at(-1)?.x ?? width - padX},${height - padY} L ${coordinates[0]?.x ?? padX},${height - padY} Z`;
  return <div className="relative"><svg viewBox={`0 0 ${width} ${height}`} className="h-52 w-full overflow-visible" role="img" aria-label="Product registration trend"><defs><linearGradient id="registration-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.32" /><stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" /></linearGradient></defs>{[0.25, 0.5, 0.75].map((position) => <line key={position} x1={padX} x2={width - padX} y1={height * position} y2={height * position} stroke="currentColor" className="text-slate-100 dark:text-slate-800" strokeDasharray="4 5" />)}<path d={area} fill="url(#registration-area)" /><path d={path} fill="none" stroke="#8b5cf6" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />{coordinates.map((coordinate, index) => <g key={labels[index]}><circle cx={coordinate.x} cy={coordinate.y} r="4" fill="#8b5cf6" stroke="white" strokeWidth="2" /><text x={coordinate.x} y={coordinate.y - 10} textAnchor="middle" className="fill-slate-500 text-[10px]">{coordinate.point}</text><text x={coordinate.x} y={height - 5} textAnchor="middle" className="fill-slate-400 text-[10px]">{labels[index]}</text></g>)}</svg><p className="mt-1 text-xs text-slate-400">Monthly count of product records created in the last six months.</p></div>;
}

function EmptyChart() { return <p className="m-auto py-12 text-center text-sm text-slate-400">No related data has been recorded yet.</p>; }

function Insight({ label, value, hint, tone, icon }: { label: string; value: string; hint: string; tone: "blue" | "amber" | "violet" | "emerald"; icon?: ReactNode }) {
  const toneClasses = { blue: "bg-blue-50 text-blue-600 dark:bg-blue-950/50", amber: "bg-amber-50 text-amber-600 dark:bg-amber-950/50", violet: "bg-violet-50 text-violet-600 dark:bg-violet-950/50", emerald: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50" };
  return <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"><div className="flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p><span className={`rounded-lg p-2 ${toneClasses[tone]}`}>{icon ?? <TrendingUp size={17} />}</span></div><p className="mt-4 truncate text-2xl font-bold text-slate-900 dark:text-white">{value}</p><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</p></div>;
}

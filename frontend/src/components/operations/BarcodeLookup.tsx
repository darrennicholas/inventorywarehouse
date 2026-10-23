"use client";

import { useState, type FormEvent } from "react";
import { Barcode, LoaderCircle, Search } from "lucide-react";
import { apiRequest } from "@/lib/api";

type LookupResult = {
  product: { sku: string; barcode?: string | null; name: string; unit?: { code?: string | null } | null };
  balances: Array<{ warehouse?: { name?: string }; quantityOnHand: number; isLowStock: boolean }>;
};

export default function BarcodeLookup() {
  const [value, setValue] = useState("");
  const [result, setResult] = useState<LookupResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function lookup(event: FormEvent) {
    event.preventDefault();
    if (!value.trim()) return;
    setLoading(true); setError(""); setResult(null);
    try {
      const response = await apiRequest<{ success: boolean; data: LookupResult }>(`/api/operations/stock-lookup?barcode=${encodeURIComponent(value.trim())}&sku=${encodeURIComponent(value.trim())}`);
      setResult(response.data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Product not found");
    } finally { setLoading(false); }
  }

  return <div className="border-b border-slate-100 bg-slate-50/60 p-5 dark:border-slate-800 dark:bg-slate-950/40">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-white"><Barcode size={17} className="text-blue-600" /> Quick barcode / SKU lookup</p><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Use a scanner or type a SKU to see stock by warehouse.</p></div>
      <form onSubmit={lookup} className="flex w-full gap-2 sm:w-auto"><div className="relative flex-1 sm:w-80"><Search size={15} className="absolute left-3 top-3 text-slate-400" /><input value={value} onChange={(event) => setValue(event.target.value)} placeholder="Scan barcode or enter SKU" className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white" /></div><button type="submit" disabled={loading || !value.trim()} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">{loading ? <LoaderCircle size={15} className="animate-spin" /> : <Search size={15} />} Find</button></form>
    </div>
    {error && <p className="mt-3 text-xs font-semibold text-red-600 dark:text-red-300">{error}</p>}
    {result && <div className="mt-4 rounded-2xl border border-blue-100 bg-white p-4 dark:border-blue-900/60 dark:bg-slate-900"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-bold text-slate-900 dark:text-white">{result.product.name}</p><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{result.product.sku} · {result.product.barcode ?? "No barcode"}</p></div><span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700 dark:bg-blue-950/50 dark:text-blue-200">{result.product.unit?.code ?? "unit"}</span></div><div className="mt-3 grid gap-2 sm:grid-cols-3">{result.balances.map((balance) => <div key={balance.warehouse?.name} className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/70"><p className="text-xs text-slate-500 dark:text-slate-400">{balance.warehouse?.name ?? "Warehouse"}</p><p className="mt-1 text-lg font-bold text-slate-900 dark:text-white">{balance.quantityOnHand}</p><p className={`text-[10px] font-semibold ${balance.isLowStock ? "text-red-600" : "text-emerald-600"}`}>{balance.isLowStock ? "Reorder recommended" : "Healthy stock"}</p></div>)}</div></div>}
  </div>;
}


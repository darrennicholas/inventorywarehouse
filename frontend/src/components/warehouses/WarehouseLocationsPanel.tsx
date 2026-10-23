"use client";

import { useCallback, useEffect, useState } from "react";
import { Edit3, MapPin, Plus, Save, Trash2, X } from "lucide-react";

import { apiRequest } from "@/lib/api";

type Location = {
  id: string;
  code: string;
  name: string;
  zone?: string | null;
  rack?: string | null;
  shelf?: string | null;
  bin?: string | null;
  capacity?: number | null;
  isActive: boolean;
};

type LocationForm = Omit<Location, "id" | "isActive"> & { isActive: boolean };
const emptyForm: LocationForm = { code: "", name: "", zone: "", rack: "", shelf: "", bin: "", capacity: null, isActive: true };
const inputClass = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-blue-500";

export default function WarehouseLocationsPanel({ warehouseId, canWrite }: { warehouseId: string; canWrite: boolean }) {
  const [rows, setRows] = useState<Location[]>([]);
  const [form, setForm] = useState<LocationForm>(emptyForm);
  const [editing, setEditing] = useState<Location | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async function load() {
    setLoading(true);
    try {
      const response = await apiRequest<{ data?: Location[] }>(`/api/warehouses/${warehouseId}/locations`);
      setRows(Array.isArray(response.data) ? response.data : []);
    } catch (reason) {
      setRows([]);
      setError(reason instanceof Error ? reason.message : "Failed to load locations");
    } finally {
      setLoading(false);
    }
  }, [warehouseId]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  function openForm(location?: Location) {
    setEditing(location ?? null);
    setForm(location ? { code: location.code, name: location.name, zone: location.zone ?? "", rack: location.rack ?? "", shelf: location.shelf ?? "", bin: location.bin ?? "", capacity: location.capacity ?? null, isActive: location.isActive } : emptyForm);
    setOpen(true);
  }

  async function save() {
    setError("");
    try {
      const endpoint = editing ? `/api/warehouses/${warehouseId}/locations/${editing.id}` : `/api/warehouses/${warehouseId}/locations`;
      await apiRequest(endpoint, { method: editing ? "PATCH" : "POST", body: JSON.stringify({ ...form, capacity: form.capacity ? Number(form.capacity) : null }) });
      setOpen(false);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Failed to save location");
    }
  }

  async function deactivate(location: Location) {
    if (!window.confirm(`Deactivate location ${location.code}?`)) return;
    try {
      await apiRequest(`/api/warehouses/${warehouseId}/locations/${location.id}`, { method: "DELETE" });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Failed to deactivate location");
    }
  }

  return <div className="mt-5 rounded-2xl border border-blue-100 bg-blue-50/50 p-4"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><span className="rounded-lg bg-blue-100 p-2 text-blue-600"><MapPin size={16} /></span><div><p className="text-sm font-bold text-slate-800">Warehouse locations</p><p className="text-[11px] text-slate-500">Zone, rack, shelf and bin structure for receiving.</p></div></div>{canWrite && <button type="button" onClick={() => openForm()} className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white"><Plus size={14} /> Add</button>}</div>{error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}{loading ? <p className="mt-4 text-xs text-slate-500">Loading locations...</p> : rows.length === 0 ? <p className="mt-4 rounded-xl border border-dashed border-blue-200 bg-white px-4 py-5 text-center text-xs text-slate-500">No storage location configured yet.</p> : <div className="mt-4 grid gap-2 sm:grid-cols-2">{rows.map((location) => <div key={location.id} className={`rounded-xl border bg-white p-3 ${location.isActive ? "border-blue-100" : "border-slate-200 opacity-60"}`}><div className="flex items-start justify-between gap-2"><div><p className="font-mono text-xs font-bold text-blue-700">{location.code}</p><p className="mt-1 text-sm font-semibold text-slate-800">{location.name}</p></div><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${location.isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{location.isActive ? "Active" : "Inactive"}</span></div><p className="mt-2 text-[11px] text-slate-500">{[location.zone && `Zone ${location.zone}`, location.rack && `Rack ${location.rack}`, location.shelf && `Shelf ${location.shelf}`, location.bin && `Bin ${location.bin}`].filter(Boolean).join(" · ") || "No coordinate detail"}</p><div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2"><span className="text-[11px] text-slate-400">Capacity {location.capacity ?? "—"}</span>{canWrite && <span className="flex gap-1"><button type="button" onClick={() => openForm(location)} className="rounded-md p-1.5 text-slate-500 hover:bg-blue-50 hover:text-blue-600"><Edit3 size={13} /></button><button type="button" disabled={!location.isActive} onClick={() => void deactivate(location)} className="rounded-md p-1.5 text-red-500 hover:bg-red-50 disabled:opacity-30"><Trash2 size={13} /></button></span>}</div></div>)}</div>}{open && canWrite && <div className="mt-4 rounded-xl border border-blue-200 bg-white p-4"><div className="flex items-center justify-between"><p className="text-xs font-bold uppercase tracking-wider text-blue-700">{editing ? "Edit location" : "New location"}</p><button type="button" onClick={() => setOpen(false)}><X size={15} className="text-slate-400" /></button></div><div className="mt-3 grid gap-3 sm:grid-cols-2"><label><span className="mb-1 block text-[11px] font-semibold text-slate-600">Code</span><input className={inputClass} value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="A-01-01" /></label><label><span className="mb-1 block text-[11px] font-semibold text-slate-600">Name</span><input className={inputClass} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Rack A shelf 1" /></label>{(["zone", "rack", "shelf", "bin"] as const).map((field) => <label key={field}><span className="mb-1 block text-[11px] font-semibold capitalize text-slate-600">{field}</span><input className={inputClass} value={form[field] ?? ""} onChange={(event) => setForm({ ...form, [field]: event.target.value })} /></label>)}<label><span className="mb-1 block text-[11px] font-semibold text-slate-600">Capacity</span><input type="number" min="1" className={inputClass} value={form.capacity ?? ""} onChange={(event) => setForm({ ...form, capacity: event.target.value ? Number(event.target.value) : null })} /></label></div><button type="button" onClick={() => void save()} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white"><Save size={14} /> Save location</button></div>}</div>;
}


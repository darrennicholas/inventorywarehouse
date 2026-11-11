"use client";

import GlobalSelect from "@/components/ui/GlobalSelect";
import ActionIconButton from "@/components/ui/ActionIconButton";
import StatusBadge from "@/components/ui/StatusBadge";
import { CheckCircle2, ClipboardCheck, Plus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiRequest } from "@/lib/api";
import { useApiQuery } from "@/hooks/useApiQuery";
import DataTable from "@/components/ui/DataTable";
import TransactionWorkflow from "@/components/operations/TransactionWorkflow";
import type { NotificationTarget } from "@/types/notification";
import ActionFeedback from "@/components/ui/ActionFeedback";
import DataPagination from "@/components/ui/DataPagination";
import { statusLabel } from "@/lib/ui-labels";

type Line = { id: string; systemQuantity: number; physicalQuantity: number | null; variance: number; product: { sku: string; name: string; unit?: { code: string } | null } };
type Session = { id: string; number: string; status: string; startedAt: string; createdBy?: { id: string }; warehouse: { name: string; code: string }; lines: Line[] };
type SessionRow = Omit<Session, "lines"> & { _count: { lines: number } };
type WarehouseOption = { id: string; code: string; name: string };

export default function StockOpnamesView({ target = null }: { target?: NotificationTarget | null }) {
  const { data: options } = useApiQuery<{ warehouses: WarehouseOption[] }>("/api/operations/options");
  const [selected, setSelected] = useState<Session | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [sessionNumber, setSessionNumber] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingCount, setSavingCount] = useState(false);
  const pendingCountSaves = useRef(new Map<string, Promise<void>>());
  const activeCountSaves = useRef(0);
  const [notice, setNotice] = useState("");
  const [noticeTone, setNoticeTone] = useState<"success" | "error" | "info">("success");
  const [staleCount, setStaleCount] = useState(false);
  const [countDrafts, setCountDrafts] = useState<Record<string, string>>({});
  const countDraftsRef = useRef<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [visibleSessions, setVisibleSessions] = useState<SessionRow[]>([]);
  const [meta, setMeta] = useState({ total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const reload = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError("");
    try {
      const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize), search: debouncedSearch.trim(), status: statusFilter });
      const response = await apiRequest<{ data: SessionRow[]; meta: { total: number; totalPages: number } }>(`/api/stock-opnames?${query}`, { signal });
      if (!signal?.aborted) { setVisibleSessions(response.data); setMeta(response.meta); }
    } catch (reason) { if (!signal?.aborted) setError(reason instanceof Error ? reason.message : "Daftar opname tidak dapat dimuat."); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [page, pageSize, debouncedSearch, statusFilter]);
  useEffect(() => { const timer = window.setTimeout(() => setDebouncedSearch(search), 250); return () => window.clearTimeout(timer); }, [search]);
  useEffect(() => { const controller = new AbortController(); void Promise.resolve().then(() => reload(controller.signal)); return () => controller.abort(); }, [reload]);
  const totalPages = Math.max(1, meta.totalPages);
  const countProgress = useMemo(() => {
    if (!selected) return null;
    return selected.lines.reduce((progress, line) => {
      const savedValue = line.physicalQuantity === null ? "" : String(line.physicalQuantity);
      const draft = countDrafts[line.id] ?? savedValue;
      if (draft.trim() !== "") progress.counted += 1;
      if (draft !== savedValue) progress.unsaved += 1;
      return progress;
    }, { counted: 0, unsaved: 0, total: selected.lines.length });
  }, [selected, countDrafts]);
  const openSession = useCallback((session: Session) => {
    setSelected(session);
    const initial = Object.fromEntries(session.lines.map((line) => [line.id, line.physicalQuantity === null ? "" : String(line.physicalQuantity)]));
    countDraftsRef.current = initial;
    setCountDrafts(initial);
  }, []);
  const openSessionById = useCallback(async (id: string) => {
    try { const response = await apiRequest<{ data: Session }>(`/api/stock-opnames/${id}`); openSession(response.data); }
    catch (reason) { setNoticeTone("error"); setNotice(reason instanceof Error ? reason.message : "Opname tidak dapat dibuka."); }
  }, [openSession]);
  useEffect(() => {
    if (!target || target.page !== "stock-opnames") return;
    let active = true;
    void apiRequest<{ data: Session }>(`/api/stock-opnames/${target.recordId}`).then((response) => { if (active) openSession(response.data); }).catch((reason) => { if (active) { setNoticeTone("error"); setNotice(reason instanceof Error ? reason.message : "Opname tidak dapat dibuka."); } });
    return () => { active = false; };
  }, [target, openSession]);
  async function countLine(line: Line, value: string) {
    if (!selected || value.trim() === "") return;
    const quantity = Number(value);
    if (!Number.isSafeInteger(quantity) || quantity < 0) {
      setNoticeTone("error");
      setNotice(`Hitungan ${line.product.sku} harus berupa bilangan bulat nol atau lebih.`);
      return;
    }
    const sessionId = selected.id;
    activeCountSaves.current += 1;
    setSavingCount(true);
    const previous = pendingCountSaves.current.get(line.id) ?? Promise.resolve();
    const task = previous.catch(() => undefined).then(async () => {
      await apiRequest(`/api/stock-opnames/${sessionId}/lines/${line.id}`, { method: "PATCH", body: JSON.stringify({ physicalQuantity: quantity }) });
      setSelected((current) => current?.id === sessionId ? { ...current, lines: current.lines.map((entry) => entry.id === line.id ? { ...entry, physicalQuantity: quantity, variance: quantity - entry.systemQuantity } : entry) } : current);
      if (countDraftsRef.current[line.id] === value) { setNoticeTone("success"); setNotice(`Hasil hitung ${line.product.sku} tersimpan.`); }
    });
    pendingCountSaves.current.set(line.id, task);
    try { await task; }
    catch (reason) { setNoticeTone("error"); setNotice(reason instanceof Error ? reason.message : "Gagal menyimpan hasil hitung. Periksa kembali nilainya, lalu coba lagi."); throw reason; }
    finally {
      if (pendingCountSaves.current.get(line.id) === task) pendingCountSaves.current.delete(line.id);
      activeCountSaves.current = Math.max(0, activeCountSaves.current - 1);
      setSavingCount(activeCountSaves.current > 0);
    }
  }
  async function submit() {
    if (!selected || saving) return;
    const incompleteLine = selected.lines.find((line) => {
      const value = countDraftsRef.current[line.id] ?? (line.physicalQuantity === null ? "" : String(line.physicalQuantity));
      return value.trim() === "" || !Number.isSafeInteger(Number(value)) || Number(value) < 0;
    });
    if (incompleteLine) {
      const value = countDraftsRef.current[incompleteLine.id] ?? (incompleteLine.physicalQuantity === null ? "" : String(incompleteLine.physicalQuantity));
      setNoticeTone("error");
      setNotice(value.trim() === "" ? `Isi hitungan fisik untuk ${incompleteLine.product.sku} sebelum mengirim sesi.` : `Hitungan ${incompleteLine.product.sku} harus berupa bilangan bulat nol atau lebih.`);
      return;
    }
    const sessionId = selected.id;
    setSaving(true);
    try {
      await waitForCountSaves();
      const latest = await apiRequest<{ success: boolean; data: Session }>(`/api/stock-opnames/${sessionId}`);
      const unsaved = latest.data.lines.filter((line) => {
        const draft = countDraftsRef.current[line.id];
        return draft !== undefined && draft.trim() !== "" && Number(draft) !== line.physicalQuantity;
      });
      const resaves = await Promise.allSettled(unsaved.map((line) => countLine(line, countDraftsRef.current[line.id])));
      const failedResave = resaves.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failedResave) throw failedResave.reason;
      await waitForCountSaves();
      const fresh = await apiRequest<{ success: boolean; data: Session }>(`/api/stock-opnames/${sessionId}`);
      setSelected(fresh.data);
      if (fresh.data.lines.some((line) => line.physicalQuantity === null)) {
        setNoticeTone("error"); setNotice("Lengkapi hitungan fisik semua produk sebelum mengirim sesi untuk persetujuan.");
        return;
      }
      const response = await apiRequest<{ success: boolean; data: Session }>(`/api/stock-opnames/${sessionId}/submit`, { method: "POST" });
      setSelected(response.data); setNoticeTone("success"); setNotice("Sesi dikirim untuk persetujuan."); setStaleCount(false); void reload();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Gagal mengirim sesi untuk persetujuan.";
      setNoticeTone("error"); setNotice(message); setStaleCount(/berubah setelah penghitungan dimulai/i.test(message));
    } finally { setSaving(false); }
  }
  async function waitForCountSaves() {
    while (pendingCountSaves.current.size > 0) {
      const results = await Promise.allSettled([...pendingCountSaves.current.values()]);
      const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failure) throw failure.reason;
    }
  }
  function startRecount() { if (!selected) return; setWarehouseId(options?.warehouses.find((item) => item.code === selected.warehouse.code)?.id ?? ""); setSessionNumber(`${selected.number}-ULANG`); setSelected(null); setStaleCount(false); setShowCreate(true); }
  async function createSession() { if (!sessionNumber || !warehouseId) return; setSaving(true); try { await apiRequest("/api/stock-opnames", { method: "POST", body: JSON.stringify({ number: sessionNumber, warehouseId }) }); setShowCreate(false); setSessionNumber(""); setWarehouseId(""); setNoticeTone("success"); setNotice("Sesi stock opname berhasil dibuat."); setStaleCount(false); void reload(); } catch (reason) { setNoticeTone("error"); setNotice(reason instanceof Error ? reason.message : "Gagal membuat sesi stock opname."); } finally { setSaving(false); } }
  return <section className="space-y-5"><div className="sf-page-hero rounded-3xl bg-gradient-to-br from-violet-700 via-indigo-700 to-blue-600 p-5 text-white shadow-lg"><p className="text-xs font-bold uppercase tracking-[0.2em] text-indigo-100">Kontrol stok fisik</p><div className="mt-2 flex flex-wrap items-end justify-between gap-4"><div><h2 className="text-2xl font-bold">Sesi stock opname</h2><p className="mt-2 text-sm text-indigo-100/80">Bandingkan stok sistem dan hasil hitung fisik per gudang melalui proses persetujuan.</p></div><div className="flex gap-2"><button type="button" onClick={() => setShowCreate(true)} className="inline-flex items-center gap-2 rounded-xl bg-indigo-100 px-4 py-2.5 text-sm font-bold text-indigo-950 transition hover:bg-indigo-200"><Plus size={16} /> Sesi baru</button><button type="button" onClick={() => void reload()} className="inline-flex items-center gap-2 rounded-xl bg-white/15 px-4 py-2.5 text-sm font-semibold hover:bg-white/25"><RefreshCw size={16} /> Muat ulang</button></div></div></div>{error && <ActionFeedback message={error} tone="error" action={{ label: "Coba lagi", onClick: () => void reload() }} />}{notice && !selected && <ActionFeedback message={notice} tone={noticeTone} onDismiss={() => setNotice("")} />}<div className="sf-filter-toolbar flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center"><GlobalSelect aria-label="Filter status opname" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"><option value="">Semua status</option>{["COUNTING", "DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "CANCELLED"].map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</GlobalSelect><p className="text-xs text-slate-500">Menampilkan {visibleSessions.length} dari {meta.total} sesi yang cocok. Pencarian mencakup nomor sesi dan gudang.</p></div><DataTable rows={visibleSessions} loading={loading} search={search} onSearch={(value) => { setSearch(value); setPage(1); }} searchPlaceholder="Cari nomor sesi atau gudang..." empty="Tidak ada sesi stock opname yang cocok." columns={[{ key: "number", header: "Sesi", render: (row) => <div><p className="font-mono font-bold text-slate-800">{row.number}</p><p className="text-xs text-slate-400">{new Date(row.startedAt).toLocaleDateString("id-ID")}</p></div> }, { key: "warehouse", header: "Gudang", render: (row) => <span className="font-semibold text-slate-700">{row.warehouse.name} <span className="text-xs text-slate-400">({row.warehouse.code})</span></span> }, { key: "lines", header: "Produk", render: (row) => <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">{row._count.lines} produk</span> }, { key: "status", header: "Status", render: (row) => <StatusBadge status={row.status} /> }, { key: "action", header: "Aksi", action: true, render: (row) => <ActionIconButton label={`Buka penghitungan sesi ${row.number}`} icon={ClipboardCheck} variant="primary" onClick={() => void openSessionById(row.id)} /> }]} /><DataPagination page={Math.min(page, totalPages)} pageSize={pageSize} total={meta.total} totalPages={totalPages} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} loading={loading} noun="sesi opname" />{showCreate && <div className="sf-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"><div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-center justify-between"><h3 className="text-xl font-bold text-slate-900">Sesi stock opname baru</h3><button type="button" onClick={() => setShowCreate(false)} className="text-2xl text-slate-400">×</button></div><div className="mt-5 space-y-4"><label className="block text-sm font-semibold text-slate-700">Nomor sesi<input value={sessionNumber} onChange={(event) => setSessionNumber(event.target.value)} placeholder="OPN-2026-001" className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5" /></label><label className="block text-sm font-semibold text-slate-700">Gudang<GlobalSelect value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5"><option value="">Pilih gudang</option>{options?.warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}</GlobalSelect></label></div><button type="button" disabled={saving || !sessionNumber || !warehouseId} onClick={() => void createSession()} className="mt-6 w-full rounded-xl bg-violet-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-50">{saving ? "Membuat..." : "Buat sesi"}</button></div></div>}{selected && <div className="sf-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" onMouseDown={(event) => event.target === event.currentTarget && setSelected(null)}><div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-widest text-violet-600">{selected.warehouse.name}</p><h3 className="mt-1 font-mono text-xl font-bold text-slate-900">{selected.number}</h3></div><button type="button" onClick={() => setSelected(null)} className="rounded-lg p-2 text-slate-400">×</button></div>{notice && <div className="mt-4"><ActionFeedback message={notice} tone={staleCount ? "info" : noticeTone} onDismiss={() => setNotice("")} action={staleCount ? { label: "Mulai hitung ulang", onClick: startRecount } : undefined} />{staleCount && <p className="mt-2 text-xs leading-5 text-amber-800">Hitungan sesi lama tetap disimpan sebagai riwayat. Sesi baru akan menggunakan jumlah sistem terbaru.</p>}</div>}<TransactionWorkflow kind="opnames" id={selected.id} status={selected.status} creatorId={selected.createdBy?.id} onChanged={() => { setSelected(null); void reload(); }} onError={(message) => { setNoticeTone("error"); setNotice(message); setStaleCount(/berubah setelah penghitungan dimulai/i.test(message)); }} />{selected.status === "COUNTING" && countProgress && <div aria-live="polite" className="mt-5 rounded-2xl border border-violet-100 bg-violet-50/70 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-bold text-slate-800">Progres hitungan fisik</p><p className="text-sm font-bold text-violet-800">{countProgress.counted} dari {countProgress.total} produk</p></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-violet-100"><div className="h-full rounded-full bg-violet-600 transition-[width]" style={{ width: `${countProgress.total ? Math.round(countProgress.counted / countProgress.total * 100) : 100}%` }} /></div><p className="mt-2 text-xs text-slate-600">{countProgress.counted < countProgress.total ? `Isi ${countProgress.total - countProgress.counted} hitungan yang masih kosong sebelum mengirim.` : countProgress.unsaved > 0 ? `${countProgress.unsaved} perubahan akan disimpan sebelum sesi diajukan.` : "Semua jumlah fisik sudah terisi dan tersimpan."}</p></div>}<div role="region" aria-label="Tabel data; gunakan gulir horizontal untuk melihat semua kolom" tabIndex={0} className="sf-table-scroll mt-5 overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">Produk</th><th className="p-3">Stok sistem</th><th className="p-3">Stok fisik</th><th className="p-3">Selisih</th></tr></thead><tbody className="divide-y divide-slate-100">{selected.lines.map((line) => <tr key={line.id}><td className="p-3"><p className="font-bold text-slate-800">{line.product.name}</p><p className="font-mono text-xs text-slate-400">{line.product.sku}</p></td><td className="p-3 font-semibold">{line.systemQuantity}</td><td className="p-3"><input type="number" min="0" step="1" disabled={saving || savingCount || !["COUNTING", "DRAFT"].includes(selected.status)} value={countDrafts[line.id] ?? (line.physicalQuantity === null ? "" : String(line.physicalQuantity))} onChange={(event) => { const next = { ...countDraftsRef.current, [line.id]: event.target.value }; countDraftsRef.current = next; setCountDrafts(next); }} onBlur={(event) => { if (event.target.value !== "" && Number(event.target.value) !== line.physicalQuantity) void countLine(line, event.target.value).catch(() => undefined); }} className="w-28 rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-violet-500" />{countDrafts[line.id] !== (line.physicalQuantity === null ? "" : String(line.physicalQuantity)) ? <span className="mt-1 block text-[11px] font-semibold text-amber-700">Belum disimpan</span> : line.physicalQuantity === null && <span className="mt-1 block text-[11px] font-medium text-slate-500">Belum dihitung</span>}</td><td className={`p-3 font-bold ${line.variance < 0 ? "text-red-600" : line.variance > 0 ? "text-emerald-600" : "text-slate-400"}`}>{line.variance > 0 ? `+${line.variance}` : line.variance}</td></tr>)}</tbody></table></div>{savingCount && <p role="status" className="mt-2 text-xs text-violet-700">Menyimpan hasil hitung. Sesi baru dapat dikirim setelah simpanan selesai.</p>}<div className="mt-5 flex justify-end gap-3"><button type="button" onClick={() => setSelected(null)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600">Tutup</button>{selected.status === "COUNTING" && <button type="button" onClick={() => void submit()} disabled={saving || savingCount || Boolean(countProgress && countProgress.counted < countProgress.total)} className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"><CheckCircle2 size={16} />{saving ? "Menyimpan lalu mengirim..." : savingCount ? "Menunggu simpan hitungan..." : countProgress && countProgress.counted < countProgress.total ? `Lengkapi ${countProgress.total - countProgress.counted} hitungan` : countProgress?.unsaved ? `Simpan ${countProgress.unsaved} hitungan & kirim` : "Kirim untuk persetujuan"}</button>}</div></div></div>}</section>;
}

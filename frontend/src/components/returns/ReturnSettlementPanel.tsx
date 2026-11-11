"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { apiRequest } from "@/lib/api";
import GlobalSelect from "@/components/ui/GlobalSelect";
import { confirmAction } from "@/components/ui/GlobalAlert";

type Entry = { id: string; kind: "REFUND" | "CREDIT"; isReversal?: boolean; amount: string; creditRemaining: string; reference: string; notes: string; createdAt: string };
type Summary = { returnValue: string; available: string; settlements: Entry[]; summary: { outstanding: string; refundable: string } };
const money = (value: string | number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR" }).format(Number(value));
const inputClass = "mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm dark:border-slate-600 dark:bg-slate-900";

export default function ReturnSettlementPanel({ id, type }: { id: string; type: "PURCHASE" | "SALE" }) {
  const { can } = useAuth();
  const [data, setData] = useState<Summary | null>(null);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [loadError, setLoadError] = useState("");
  const [kind, setKind] = useState("REFUND"); const [amount, setAmount] = useState("");
  const [reference, setReference] = useState(""); const [notes, setNotes] = useState("");
  const [creditId, setCreditId] = useState(""); const [targets, setTargets] = useState<{ id: string; number: string }[]>([]);
  const [targetId, setTargetId] = useState(""); const [applyAmount, setApplyAmount] = useState("");
  const [targetPage, setTargetPage] = useState(1); const [targetSearch, setTargetSearch] = useState(""); const [targetTotal, setTargetTotal] = useState(0);
  const [reverseId, setReverseId] = useState(""); const [reverseReference, setReverseReference] = useState(""); const [reverseNotes, setReverseNotes] = useState("");
  const readable = can("payments.read");
  const writable = can("payments.write") && can(type === "PURCHASE" ? "purchase-returns.approve" : "sales-returns.approve");
  useEffect(() => {
    if (!readable) return;
    const controller = new AbortController();
    void apiRequest<{ data: Summary }>(`/api/operations/return-settlements/${id}`, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) { setData(result.data); setLoadError(""); } }).catch((reason) => { if (!controller.signal.aborted) setLoadError(reason instanceof Error ? reason.message : "Gagal memuat settlement."); });
    return () => controller.abort();
  }, [id, readable, revision]);
  async function settle() {
    if (busy || !data) return;
    if (!(Number(amount) > 0) || Number(amount) > Number(data.available) || reference.trim().length < 3 || notes.trim().length < 5) { setError("Isi nominal sesuai saldo tersedia, referensi, dan catatan minimal 5 karakter."); return; }
    if (!await confirmAction(`Catat ${kind === "REFUND" ? "pengembalian uang" : "kredit"} ${money(amount)}? Pencatatan bersifat final; pastikan bukti dan pihak penerima benar.`, { title: "Konfirmasi settlement", confirmLabel: "Catat" })) return;
    setBusy(true); setError("");
    try { await apiRequest(`/api/operations/return-settlements/${id}`, { method: "POST", body: JSON.stringify({ kind, amount, reference: reference.trim(), notes: notes.trim() }) }); setAmount(""); setReference(""); setNotes(""); setNotice("Pencatatan refund atau kredit berhasil disimpan."); setRevision((value) => value + 1); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Settlement gagal."); } finally { setBusy(false); }
  }
  useEffect(() => {
    if (!creditId) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ page: String(targetPage), pageSize: "20", search: targetSearch });
    void apiRequest<{ data: { id: string; number: string }[]; meta: { total: number } }>(`/api/operations/credits/${creditId}/targets?${query}`, { signal: controller.signal }).then((result) => { if (!controller.signal.aborted) { setTargets(result.data); setTargetTotal(result.meta.total); } }).catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Tagihan tidak dapat dimuat."); });
    return () => controller.abort();
  }, [creditId, targetPage, targetSearch]);
  function chooseCredit(value: string) { setCreditId(value); setTargetId(""); setTargets([]); setApplyAmount(""); setTargetPage(1); setTargetSearch(""); }
  async function applyCredit() {
    if (busy || !creditId || !targetId || !(Number(applyAmount) > 0)) return;
    if (!await confirmAction(`Gunakan kredit ${money(applyAmount)} untuk tagihan terpilih? Saldo kredit dan sisa tagihan diperiksa ulang oleh server.`, { title: "Gunakan kredit", confirmLabel: "Terapkan" })) return;
    setBusy(true); setError("");
    try { await apiRequest(`/api/operations/credits/${creditId}/apply`, { method: "POST", body: JSON.stringify({ targetId, amount: applyAmount }) }); setCreditId(""); setNotice("Kredit berhasil diterapkan ke tagihan."); setRevision((value) => value + 1); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Kredit tidak dapat digunakan."); } finally { setBusy(false); }
  }
  async function reverse(entry: Entry) {
    if (busy || !reverseReference.trim() || reverseNotes.trim().length < 10) { setError("Isi referensi dan alasan pembalikan minimal 10 karakter."); return; }
    if (!await confirmAction(`Catat pembalikan ${entry.kind} ${money(entry.amount)}? Untuk refund, lakukan/konfirmasi pengembalian dana terlebih dahulu. Kredit yang sudah dipakai tidak dapat dibalik.`, { title: "Pembalikan settlement", confirmLabel: "Catat pembalikan" })) return;
    setBusy(true); setError("");
    try { await apiRequest(`/api/operations/return-settlements/${entry.id}/reverse`, { method: "POST", body: JSON.stringify({ reference: reverseReference.trim(), notes: reverseNotes.trim() }) }); setReverseId(""); setReverseReference(""); setReverseNotes(""); setNotice("Pembalikan berhasil dicatat."); setRevision((value) => value + 1); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Settlement tidak dapat dibalik."); } finally { setBusy(false); }
  }
  if (!readable) return null;
  return <section className="mt-6 space-y-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
    <div><h3 className="font-semibold">Refund & kredit return</h3><p className="mt-1 text-xs text-slate-500">Return posted langsung mengurangi tagihan asal. Refund/kredit hanya untuk kelebihan pembayaran; tidak ada transfer bank otomatis.</p></div>
    {error && <p role="alert" className="text-sm text-red-600 dark:text-red-300">{error}</p>}
    {notice && <p role="status" className="rounded-lg bg-emerald-50 p-2 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">{notice}</p>}
    {loadError && <div role="alert" className="flex items-center gap-3 text-sm text-red-600 dark:text-red-300"><span>{loadError}</span><button type="button" onClick={() => { setLoadError(""); setRevision((value) => value + 1); }} className="rounded-lg bg-red-100 px-3 py-1 font-semibold hover:bg-red-200">Coba lagi</button></div>}
    {!data || loadError ? !loadError && <p role="status" className="text-sm text-slate-500">Memuat rincian keuangan…</p> : <>
      <dl className="grid grid-cols-2 gap-3 text-xs">{[["Nilai return", data.returnValue], ["Dapat diselesaikan", data.available], ["Sisa tagihan asal", data.summary.outstanding], ["Kelebihan bayar asal", data.summary.refundable]].map(([label, value]) => <div key={label}><dt className="text-slate-500">{label}</dt><dd className="mt-1 font-semibold">{money(value)}</dd></div>)}</dl>
      {writable && Number(data.available) > 0 && <fieldset disabled={busy} className="grid gap-3 border-t pt-4 sm:grid-cols-2 dark:border-slate-700">
        <label className="text-xs">Metode<GlobalSelect value={kind} onChange={(event) => setKind(event.target.value)} className={inputClass}><option value="REFUND">Refund uang</option><option value="CREDIT">Kredit tagihan berikutnya</option></GlobalSelect></label>
        <label className="text-xs">Nominal<input type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} className={inputClass} /></label>
        <label className="text-xs sm:col-span-2">Referensi bukti / nomor kredit<input value={reference} maxLength={120} onChange={(event) => setReference(event.target.value)} className={inputClass} /></label>
        <label className="text-xs sm:col-span-2">Catatan<textarea value={notes} maxLength={1000} onChange={(event) => setNotes(event.target.value)} className={inputClass} /></label>
        <button type="button" onClick={() => void settle()} className="w-fit rounded-lg bg-blue-600 px-3 py-2 text-sm text-white">{busy ? "Mencatat…" : "Catat settlement"}</button>
      </fieldset>}
      <div className="space-y-2">{data.settlements.map((entry) => <article key={entry.id} className="rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-800"><p className="font-semibold">{entry.isReversal ? "PEMBALIKAN · " : ""}{entry.kind} · {money(entry.amount)}</p><p className="mt-1">{entry.reference} · {new Date(entry.createdAt).toLocaleString("id-ID")}</p><p className="mt-1 text-slate-500">{entry.notes}</p>{entry.kind === "CREDIT" && !entry.isReversal && <p className="mt-2">Kredit tersisa: <strong>{money(entry.creditRemaining)}</strong></p>}{can("payments.write") && entry.kind === "CREDIT" && !entry.isReversal && Number(entry.creditRemaining) > 0 && <button type="button" disabled={busy} onClick={() => chooseCredit(entry.id)} className="mt-2 font-semibold text-blue-600 dark:text-blue-300">Gunakan untuk tagihan lain →</button>}{writable && !entry.isReversal && <div className="mt-2"><button type="button" disabled={busy} onClick={() => { setReverseId(reverseId === entry.id ? "" : entry.id); setReverseReference(""); setReverseNotes(""); }} className="font-semibold text-rose-600">Catat pembalikan</button>{reverseId === entry.id && <div className="mt-2 grid gap-2 sm:grid-cols-2"><input value={reverseReference} maxLength={120} onChange={(event) => setReverseReference(event.target.value)} placeholder="Referensi bukti koreksi/pengembalian" className={inputClass} /><input value={reverseNotes} maxLength={1000} onChange={(event) => setReverseNotes(event.target.value)} placeholder="Alasan minimal 10 karakter" className={inputClass} /><button type="button" disabled={busy} onClick={() => void reverse(entry)} className="w-fit rounded-lg bg-rose-600 px-3 py-2 text-xs text-white">Simpan pembalikan</button></div>}</div>}</article>)}</div>
      {creditId && <fieldset disabled={busy} className="space-y-3 rounded-lg border p-3 dark:border-slate-700"><legend className="text-xs font-semibold">Aplikasikan kredit</legend><p className="text-xs text-slate-500">Hanya tagihan aktif untuk supplier/customer yang sama.</p><label className="block text-xs">Cari nomor tagihan<input value={targetSearch} onChange={(event) => { setTargetSearch(event.target.value); setTargetPage(1); setTargetId(""); }} className={inputClass} /></label><div className="flex gap-2 text-xs"><span>{targetTotal} tagihan · Halaman {targetPage}</span><button type="button" disabled={targetPage <= 1} onClick={() => { setTargetId(""); setTargetPage(targetPage - 1); }}>Sebelumnya</button><button type="button" disabled={targetPage * 20 >= targetTotal} onClick={() => { setTargetId(""); setTargetPage(targetPage + 1); }}>Berikutnya</button></div><label className="block text-xs">Tagihan tujuan<GlobalSelect value={targetId} onChange={(event) => setTargetId(event.target.value)} className={inputClass}><option value="">Pilih tagihan</option>{targets.map((target) => <option key={target.id} value={target.id}>{target.number}</option>)}</GlobalSelect></label><label className="block text-xs">Nominal<input type="number" min="0.01" step="0.01" value={applyAmount} onChange={(event) => setApplyAmount(event.target.value)} className={inputClass} /></label><button type="button" onClick={() => void applyCredit()} disabled={!targetId || !(Number(applyAmount) > 0)} className="rounded-lg bg-blue-600 px-3 py-2 text-xs text-white disabled:opacity-50">Terapkan kredit</button></fieldset>}
    </>}
  </section>;
}

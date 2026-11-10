"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { apiRequest } from "@/lib/api";
import { confirmAction } from "@/components/ui/GlobalAlert";
import { statusLabel } from "@/lib/ui-labels";

type Kind = "purchases" | "sales" | "adjustments" | "transfers" | "returns" | "opnames";
type Event = { id: string; action: string; actor: string; createdAt: string; reason: string | null };

function PaymentSummary({ kind, id }: { kind: "purchases" | "sales"; id: string }) {
  const { can } = useAuth();
  const [data, setData] = useState<{ total: string; paid: string; outstanding: string; returnedValue?: string; creditApplied?: string; settledReturns?: string; refundable?: string; paymentDueDate: string | null; payments: { id: string; number: string; amount: string; status: string; paymentDate: string }[] } | null>(null);
  const [dueDate, setDueDate] = useState(""); const [savingDue, setSavingDue] = useState(false); const [dueError, setDueError] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => { let active = true; const query = new URLSearchParams({ type: kind === "purchases" ? "PURCHASE" : "SALE", id }); void apiRequest<{ data: NonNullable<typeof data> }>(`/api/operations/payment-summary?${query}`).then((result) => { if (active) { setData(result.data); setDueDate(result.data.paymentDueDate?.slice(0, 10) ?? ""); } }).catch(() => { if (active) setFailed(true); }); return () => { active = false; }; }, [kind, id]);
  async function saveDueDate() { setSavingDue(true); setDueError(""); try { await apiRequest("/api/operations/payment-due-date", { method: "PATCH", body: JSON.stringify({ type: kind === "purchases" ? "PURCHASE" : "SALE", id, date: dueDate || null }) }); setData((old) => old ? { ...old, paymentDueDate: dueDate || null } : old); } catch (reason) { setDueError(reason instanceof Error ? reason.message : "Tanggal tidak dapat disimpan."); } finally { setSavingDue(false); } }
  const money = (value: string) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 2 }).format(Number(value));
  return <div className="space-y-2 border-t border-slate-200 pt-3 dark:border-slate-700"><p className="text-xs font-bold">Ringkasan pembayaran</p>{failed ? <p className="text-xs text-red-600">Pembayaran tidak dapat dimuat.</p> : !data ? <p className="text-xs text-slate-500">Memuat pembayaran…</p> : <><p className="text-xs">Tagihan {money(data.total)} · Dibayar {money(data.paid)} · Sisa {money(data.outstanding)}</p><p className="text-xs text-slate-500">Tagihan sudah dikurangi return posted. Saldo dibayar memperhitungkan pembayaran PAID, kredit masuk, dan refund/kredit return. Maksimal 50 pembayaran terbaru.</p><p className="text-xs">Return {money(data.returnedValue ?? "0")} · Kredit masuk {money(data.creditApplied ?? "0")} · Settlement return {money(data.settledReturns ?? "0")} · Kelebihan bayar {money(data.refundable ?? "0")}</p><p className="text-xs">Jatuh tempo: {data.paymentDueDate?.slice(0, 10) ?? "Belum ditetapkan"}</p>{can("payments.write") && <div className="flex flex-wrap items-end gap-2"><label className="text-xs">Atur jatuh tempo<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className="mt-1 block rounded border p-2 dark:bg-slate-900" /></label><button type="button" disabled={savingDue} onClick={() => void saveDueDate()} className="rounded bg-blue-600 px-3 py-2 text-xs text-white disabled:opacity-50">{savingDue ? "Menyimpan…" : "Simpan tanggal"}</button></div>}{dueError && <p role="alert" className="text-xs text-red-600">{dueError}</p>}{data.payments.map((payment) => <p key={payment.id} className="text-xs text-slate-600 dark:text-slate-300">{payment.number} · {statusLabel(payment.status)} · {money(payment.amount)} · {new Date(payment.paymentDate).toLocaleDateString("id-ID")}</p>)}</>}</div>;
}

const stages: Record<Kind, { label: string; statuses: string[]; next: string }[]> = {
  purchases: [{ label: "Draf", statuses: ["DRAFT"], next: "Petugas pembelian mengirim pesanan untuk persetujuan." }, { label: "Persetujuan", statuses: ["PENDING"], next: "Penyetuju sesuai kebijakan memeriksa pesanan." }, { label: "Penerimaan", statuses: ["APPROVED", "PARTIALLY_RECEIVED"], next: "Petugas mencatat barang yang diterima." }, { label: "Selesai", statuses: ["RECEIVED"], next: "Seluruh barang sudah diterima." }],
  sales: [{ label: "Draf", statuses: ["DRAFT"], next: "Petugas penjualan dapat melakukan reservasi stok." }, { label: "Reservasi", statuses: ["RESERVED"], next: "Petugas gudang menyiapkan pengiriman." }, { label: "Pengiriman", statuses: ["PICKING", "PACKED", "PARTIALLY_SHIPPED", "SHIPPED"], next: "Petugas gudang melanjutkan picking, packing, dan pengiriman." }, { label: "Selesai", statuses: ["COMPLETED"], next: "Penjualan selesai." }],
  adjustments: [{ label: "Draf", statuses: ["DRAFT"], next: "Penyetuju penyesuaian memeriksa alasan dan jumlah stok." }, { label: "Dibukukan", statuses: ["POSTED"], next: "Penyesuaian sudah memengaruhi stok." }],
  transfers: [{ label: "Draf", statuses: ["DRAFT"], next: "Penyetuju transfer memeriksa gudang asal dan tujuan." }, { label: "Dalam perjalanan", statuses: ["IN_TRANSIT"], next: "Petugas menyelesaikan transfer dan perpindahan stok." }, { label: "Selesai", statuses: ["COMPLETED"], next: "Transfer selesai." }],
  returns: [{ label: "Draf", statuses: ["DRAFT"], next: "Petugas retur mengirim permintaan untuk persetujuan." }, { label: "Persetujuan", statuses: ["PENDING"], next: "Penyetuju retur memeriksa barang dan alasan retur." }, { label: "Disetujui", statuses: ["APPROVED"], next: "Penyetuju memproses dampak stok retur." }, { label: "Dibukukan", statuses: ["POSTED"], next: "Retur selesai dibukukan." }],
  opnames: [{ label: "Menghitung", statuses: ["DRAFT", "COUNTING"], next: "Petugas menghitung stok fisik dan mengirim hasilnya." }, { label: "Persetujuan", statuses: ["SUBMITTED"], next: "Penyetuju opname memeriksa selisih stok." }, { label: "Selesai", statuses: ["APPROVED"], next: "Opname disetujui dan selisih diproses." }],
};

export default function TransactionWorkflow({ kind, id, status, returnType, creatorId, onChanged, onError }: { kind: Kind; id: string; status: string; returnType?: "PURCHASE" | "SALE"; creatorId?: string | null; onChanged?: () => void; onError?: (message: string) => void }) {
  const { can, user } = useAuth();
  const [events, setEvents] = useState<Event[]>([]);
  const [reservation, setReservation] = useState<{ createdAt: string | null; expiresAt: string | null; quantity: number } | null>(null);
  const [reviewRole, setReviewRole] = useState("");
  const [reason, setReason] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [showRelease, setShowRelease] = useState(false);
  const [releaseReason, setReleaseReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const steps = stages[kind];
  const index = steps.findIndex((step) => step.statuses.includes(status));
  const permission = kind === "returns" ? `${returnType === "PURCHASE" ? "purchase-returns" : "sales-returns"}.approve` : kind === "opnames" ? "stock-opnames.approve" : `${kind}.approve`;
  const awaiting = (kind === "purchases" || kind === "returns") ? status === "PENDING" : kind === "opnames" ? status === "SUBMITTED" : (kind === "adjustments" || kind === "transfers") && status === "DRAFT";
  const nextStepLabel = status === "REVISION" ? "Tindak lanjut" : status === "CANCELLED" || (index >= 0 && index === steps.length - 1) ? "Status proses" : index >= 0 ? "Langkah berikutnya" : "Status saat ini";
  const nextStepMessage = status === "REVISION" ? "Pembuat dokumen perlu memperbaiki dan mengajukan kembali transaksi melalui tombol edit." : status === "CANCELLED" ? "Transaksi dibatalkan. Periksa riwayat untuk alasannya." : index >= 0 ? steps[index].next : `Status saat ini: ${statusLabel(status)}.`;
  useEffect(() => {
    let active = true;
    void apiRequest<{ data: Event[]; reviewRole?: string; reservation?: { createdAt: string | null; expiresAt: string | null; quantity: number } | null }>(`/api/operations/workflow/${kind}/${id}/history`).then((result) => { if (active) { setEvents(result.data ?? []); setReviewRole(result.reviewRole ?? ""); setReservation(result.reservation ?? null); } }).catch(() => { if (active) setError("Riwayat transaksi tidak dapat dimuat."); });
    return () => { active = false; };
  }, [kind, id]);

  async function reject() {
    if (reason.trim().length < 5) { setError("Isi alasan penolakan minimal 5 karakter."); return; }
    setSaving(true); setError("");
    try { await apiRequest(`/api/operations/workflow/${kind}/${id}/reject`, { method: "POST", body: JSON.stringify({ reason: reason.trim() }) }); onChanged?.(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Penolakan gagal."); }
    finally { setSaving(false); }
  }

  async function approveOpname() {
    if (!await confirmAction("Setujui opname dan terapkan selisih ke stok?", { title: "Setujui opname", confirmLabel: "Ya, setujui", tone: "warning" })) return;
    setSaving(true); setError("");
    try { await apiRequest(`/api/stock-opnames/${id}/approve`, { method: "POST" }); onChanged?.(); }
    catch (failure) { const message = failure instanceof Error ? failure.message : "Persetujuan gagal."; setError(message); onError?.(message); }
    finally { setSaving(false); }
  }

  async function releaseReservation() {
    if (releaseReason.trim().length < 5) { setError("Isi alasan pelepasan minimal 5 karakter."); return; }
    if (!await confirmAction("Lepaskan reservasi dan kembalikan penjualan ke draf? Stok dapat digunakan transaksi lain.", { title: "Lepaskan reservasi", confirmLabel: "Ya, lepaskan" })) return;
    setSaving(true); setError("");
    try { await apiRequest(`/api/operations/sales/${id}/release-reservation`, { method: "POST", body: JSON.stringify({ reason: releaseReason.trim() }) }); onChanged?.(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Reservasi tidak dapat dilepaskan."); }
    finally { setSaving(false); }
  }

  return <section className="mt-5 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800"><div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-bold text-slate-900 dark:text-white">Alur transaksi</h4><span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-800 dark:bg-blue-950 dark:text-blue-200">{statusLabel(status)}</span></div><div aria-label={`Tahapan transaksi, status ${statusLabel(status)}`} className="flex flex-wrap items-center gap-2">{steps.map((step, i) => <span key={step.label} aria-current={i === index ? "step" : undefined} className={`rounded-full px-3 py-1 text-xs font-semibold ${i === index ? "bg-blue-600 text-white" : i < index ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-200"}`}>{step.label}</span>)}</div><div aria-live="polite" className="rounded-xl border border-blue-100 bg-blue-50/80 p-3 dark:border-blue-900/60 dark:bg-blue-950/30"><p className="text-[11px] font-bold uppercase tracking-wide text-blue-700 dark:text-blue-300">{nextStepLabel}</p><p className="mt-1 text-xs leading-5 text-slate-700 dark:text-slate-200">{nextStepMessage} {awaiting && "Pembuat dokumen tidak dapat menyetujui atau menolak dokumennya sendiri; hak dan batas nominal tetap diperiksa."}</p></div>
    {(kind === "purchases" || kind === "sales") && can("payments.read") && <PaymentSummary key={`${kind}:${id}`} kind={kind} id={id} />}
    {kind === "sales" && reservation?.createdAt && <p className="rounded-lg bg-blue-50 p-2 text-xs text-blue-800 dark:bg-blue-950/40 dark:text-blue-200">Reservasi aktif: {reservation.quantity} unit sejak {new Date(reservation.createdAt).toLocaleString("id-ID")}{reservation.expiresAt ? ` · batas ${new Date(reservation.expiresAt).toLocaleString("id-ID")}` : ""}. Periksa proses pengiriman bila tertahan; jangan melepas reservasi tanpa memastikan status pengiriman.</p>}
    {kind === "sales" && status === "RESERVED" && can("sales.write") && <div className="space-y-2">{showRelease ? <><label className="block text-xs font-semibold">Alasan pelepasan<textarea value={releaseReason} onChange={(event) => setReleaseReason(event.target.value)} maxLength={500} rows={2} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900" /></label><div className="flex gap-2"><button type="button" disabled={saving} onClick={() => void releaseReservation()} className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Lepaskan</button><button type="button" disabled={saving} onClick={() => setShowRelease(false)} className="rounded-lg border px-3 py-2 text-xs">Batal</button></div></> : <button type="button" onClick={() => setShowRelease(true)} className="rounded-lg border border-amber-300 px-3 py-2 text-xs font-semibold text-amber-800 dark:text-amber-200">Lepaskan reservasi</button>}</div>}
    {awaiting && reviewRole && <p className="text-xs font-semibold text-blue-700 dark:text-blue-300">Pemeriksa: {reviewRole}</p>}
    {awaiting && !can(permission) && <p className="rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">Mode lihat: tindakan persetujuan atau penolakan hanya tersedia bagi role yang memiliki hak pemeriksaan untuk tahap ini.</p>}
    <div className="space-y-1 border-t border-slate-200 pt-3 dark:border-slate-700"><p className="text-xs font-bold text-slate-700 dark:text-slate-200">Riwayat perubahan</p><p className="text-xs text-slate-500">Menampilkan hingga 50 perubahan yang tercatat; transaksi lama mungkin tidak memiliki audit lengkap.</p>{events.length === 0 ? <p className="text-xs text-slate-500">Belum ada perubahan tercatat.</p> : events.map((event) => <p key={event.id} className="text-xs text-slate-600 dark:text-slate-300">{({ REJECT: "Ditolak", APPROVE: "Disetujui", SUBMIT: "Diajukan", RESUBMIT: "Diajukan kembali", CREATE: "Dibuat", UPDATE: "Diubah", POST: "Dibukukan", RECEIVE: "Diterima", RESERVE: "Direservasi", CANCEL: "Dibatalkan" } as Record<string, string>)[event.action] ?? event.action} · {event.actor} · {new Date(event.createdAt).toLocaleString("id-ID")}{event.reason ? ` — ${event.reason}` : ""}</p>)}</div>
    {(["RECEIVED", "COMPLETED", "POSTED", "APPROVED"].includes(status)) && <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">Dokumen yang sudah berdampak pada stok tidak dikoreksi dengan mengubah histori. Gunakan retur, penyesuaian stok, atau dokumen baru sesuai kasus dan izin Anda.</p>}
    {awaiting && creatorId && user?.id === creatorId && <p className="text-xs text-amber-700 dark:text-amber-300">Anda pembuat dokumen ini; minta pengguna lain yang berwenang untuk melakukan pemeriksaan.</p>}
    {awaiting && can(permission) && (!creatorId || user?.id !== creatorId) && <div>{!showReject ? <div className="flex flex-wrap gap-2">{kind === "opnames" && <button type="button" disabled={saving} onClick={() => void approveOpname()} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Setujui opname</button>}<button type="button" onClick={() => setShowReject(true)} className="rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700">Tolak permintaan</button></div> : <div className="space-y-2"><label className="block text-xs font-semibold text-slate-700 dark:text-slate-200">Alasan penolakan<textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} rows={2} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm dark:border-slate-600 dark:bg-slate-900" /></label><p className="text-xs text-slate-500">{kind === "adjustments" || kind === "transfers" ? "Dokumen dikembalikan kepada pembuat untuk direvisi dan diajukan kembali." : "Dokumen dikembalikan untuk diperbaiki dan diajukan kembali."}</p><div className="flex gap-2"><button type="button" disabled={saving} onClick={() => void reject()} className="rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{saving ? "Memproses..." : "Konfirmasi penolakan"}</button><button type="button" disabled={saving} onClick={() => setShowReject(false)} className="rounded-lg border px-3 py-2 text-xs">Batal</button></div></div>}</div>}
    {error && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{error}</p>}
  </section>;
}

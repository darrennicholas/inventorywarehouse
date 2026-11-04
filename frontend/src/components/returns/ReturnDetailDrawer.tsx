
"use client";

import { X } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { apiRequest } from "@/lib/api";
import { confirmAction } from "@/components/ui/GlobalAlert";
import GlobalSelect from "@/components/ui/GlobalSelect";
import AttachmentPanel from "@/components/operations/AttachmentPanel";

import type { ReturnItem, ReturnRecord } from "@/types/returns";
import ReturnStatusBadge from "./ReturnStatusBadge";
import TransactionWorkflow from "@/components/operations/TransactionWorkflow";
import ReturnSettlementPanel from "./ReturnSettlementPanel";

function ItemInspection({ record, item, writable }: { record: ReturnRecord; item: ReturnItem; writable: boolean }) {
  const [inspection, setInspection] = useState(item.inspection ?? null);
  const [condition, setCondition] = useState(item.inspection?.condition ?? item.condition);
  const [disposition, setDisposition] = useState(item.inspection?.recommendedDisposition ?? item.disposition);
  const [notes, setNotes] = useState(item.inspection?.notes ?? "");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function save() {
    if (notes.trim().length < 3) { setError("Isi catatan pemeriksaan minimal tiga karakter."); return; }
    setBusy(true); setError("");
    try { const result = await apiRequest<{ data: NonNullable<ReturnItem["inspection"]> }>(`/api/returns/${record.id}/items/${item.id}/inspection`, { method: "PUT", body: JSON.stringify({ condition, recommendedDisposition: disposition, notes: notes.trim() }) }); setInspection(result.data); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Pemeriksaan tidak dapat disimpan."); }
    finally { setBusy(false); }
  }
  const differs = inspection && (inspection.condition !== item.condition || inspection.recommendedDisposition !== item.disposition);
  return <div className="mt-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-800"><p className="text-xs font-semibold">Pemeriksaan item</p>{inspection && <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{inspection.condition} · {inspection.recommendedDisposition} · {inspection.inspectedBy?.fullName ?? "Petugas"} · {new Date(inspection.inspectedAt).toLocaleString("id-ID")}<br />{inspection.notes}</p>}{differs && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">Hasil berbeda dari detail return; dokumen tidak dapat diposting. Batalkan dan buat return yang benar.</p>}{writable && <div className="mt-2 grid gap-2 sm:grid-cols-2"><label className="text-xs">Kondisi<GlobalSelect value={condition} onChange={(event) => setCondition(event.target.value as typeof condition)} className="mt-1 w-full p-2">{["GOOD", "DAMAGED", "EXPIRED", "DEFECTIVE"].map((value) => <option key={value}>{value}</option>)}</GlobalSelect></label><label className="text-xs">Rekomendasi<GlobalSelect value={disposition} onChange={(event) => setDisposition(event.target.value as typeof disposition)} className="mt-1 w-full p-2">{["RESTOCK", "QUARANTINE", "SCRAP"].map((value) => <option key={value}>{value}</option>)}</GlobalSelect></label><label className="text-xs sm:col-span-2">Catatan<textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1000} className="mt-1 w-full rounded-lg border p-2 dark:bg-slate-900" /></label><button type="button" disabled={busy} onClick={() => void save()} className="w-fit rounded-lg bg-blue-600 px-3 py-2 text-xs text-white disabled:opacity-50">{busy ? "Menyimpan…" : "Simpan hasil item"}</button></div>}{error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}</div>;
}

export default function ReturnDetailDrawer({
  record,
  onClose,
  onChanged,
}: {
  record: ReturnRecord;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { can } = useAuth();
  const [inspection, setInspection] = useState(record.inspection ?? null);
  const [inspectionStatus, setInspectionStatus] = useState<"PENDING" | "COMPLETED" | "FOLLOW_UP">(record.inspection?.status ?? "PENDING");
  const [inspectionNotes, setInspectionNotes] = useState(record.inspection?.notes ?? "");
  const [inspectionSaving, setInspectionSaving] = useState(false);
  const [inspectionError, setInspectionError] = useState("");
  async function saveInspection() {
    if (inspectionNotes.trim().length < 3) { setInspectionError("Isi catatan pemeriksaan minimal tiga karakter."); return; }
    if (!await confirmAction("Simpan hasil pemeriksaan return ini? Status ini tidak otomatis mengubah stok.", { title: "Simpan pemeriksaan", confirmLabel: "Simpan" })) return;
    setInspectionSaving(true); setInspectionError("");
    try { const result = await apiRequest<{ data: NonNullable<ReturnRecord["inspection"]> }>(`/api/returns/${record.id}/inspection`, { method: "PUT", body: JSON.stringify({ status: inspectionStatus, notes: inspectionNotes.trim() }) }); setInspection(result.data); }
    catch (error) { setInspectionError(error instanceof Error ? error.message : "Pemeriksaan tidak dapat disimpan."); }
    finally { setInspectionSaving(false); }
  }
  const source =
    record.type === "PURCHASE"
      ? record.purchaseOrder?.number
      : record.sale?.number;

  return (
    <div
      className="sf-modal-overlay fixed inset-0 z-50 flex justify-end bg-slate-950/40"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Return details"
        className="h-full w-full max-w-2xl overflow-y-auto bg-white p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase text-slate-400">
              Return detail
            </p>
            <h2 className="text-xl font-bold text-slate-900">
              {record.number}
            </h2>
          </div>

          <button
            aria-label="Close"
            onClick={onClose}
            className="rounded-xl p-2 hover:bg-slate-100"
          >
            <X size={20} />
          </button>
        </div>

        <div className="mt-4">
          <ReturnStatusBadge status={record.status} />
        </div>
        <TransactionWorkflow kind="returns" id={record.id} status={record.status} returnType={record.type} creatorId={record.createdById} onChanged={onChanged} />

        <section className="mt-5 space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
          <h3 className="text-sm font-bold">Pemeriksaan barang</h3>
          <p className="text-xs text-slate-500">Status pemeriksaan terpisah dari approval dan tidak mengubah stok. Jika pemeriksaan dicatat, status harus selesai sebelum posting; return tanpa catatan pemeriksaan mengikuti alur lama.</p>
          <p className="text-xs">Status: <strong>{inspection?.status ?? "BELUM DIPERIKSA"}</strong>{inspection?.inspectedBy && ` · ${inspection.inspectedBy.fullName} · ${new Date(inspection.inspectedAt).toLocaleString("id-ID")}`}</p>
          {inspection?.notes && <p className="text-xs text-slate-600 dark:text-slate-300">{inspection.notes}</p>}
          {can(`${record.type === "PURCHASE" ? "purchase-returns" : "sales-returns"}.write`) && ["DRAFT", "PENDING", "APPROVED"].includes(record.status) && <><label className="block text-xs font-semibold">Hasil<GlobalSelect value={inspectionStatus} onChange={(event) => setInspectionStatus(event.target.value as typeof inspectionStatus)} className="mt-1 w-full rounded-lg border p-2 dark:bg-slate-800"><option value="PENDING">Menunggu pemeriksaan</option><option value="COMPLETED">Pemeriksaan selesai</option><option value="FOLLOW_UP">Perlu tindak lanjut</option></GlobalSelect></label><label className="block text-xs font-semibold">Catatan<textarea value={inspectionNotes} onChange={(event) => setInspectionNotes(event.target.value)} maxLength={1000} className="mt-1 w-full rounded-lg border p-2 dark:bg-slate-800" /></label><button type="button" disabled={inspectionSaving} onClick={() => void saveInspection()} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{inspectionSaving ? "Menyimpan…" : "Simpan pemeriksaan"}</button></>}
          {inspectionError && <p role="alert" className="text-xs text-red-600">{inspectionError}</p>}
        </section>

        <dl className="mt-6 grid grid-cols-2 gap-4 text-sm">
          {[
            ["Type", record.type],
            ["Original transaction", source ?? "—"],
            [
              "Warehouse",
              record.warehouse?.name ?? record.warehouseId,
            ],
            [
              "Created by",
              record.createdBy?.fullName ?? "—",
            ],
            [
              "Approved by",
              record.approvedBy?.fullName ?? "—",
            ],
            [
              "Created",
              new Date(record.createdAt).toLocaleString(
                "id-ID"
              ),
            ],
            [
              "Approved",
              record.approvedAt
                ? new Date(record.approvedAt).toLocaleString(
                    "id-ID"
                  )
                : "—",
            ],
            [
              "Posted",
              record.postedAt
                ? new Date(record.postedAt).toLocaleString(
                    "id-ID"
                  )
                : "—",
            ],
          ].map(([key, value]) => (
            <div key={key}>
              <dt className="text-slate-400">{key}</dt>
              <dd className="mt-1 font-semibold text-slate-800">
                {value}
              </dd>
            </div>
          ))}
        </dl>

        <section className="mt-6 rounded-xl bg-slate-50 p-4">
          <p className="text-xs text-slate-500">
            Reason
          </p>
          <p className="mt-1 text-sm text-slate-800">
            {record.reason}
          </p>

          <p className="mt-3 text-xs text-slate-500">
            Notes
          </p>
          <p className="mt-1 text-sm text-slate-800">
            {record.notes ?? "—"}
          </p>
        </section>

        <h3 className="mt-6 font-bold text-slate-900">
          Return items ({record.items.length})
        </h3>

        <div className="mt-3 space-y-3">
          {record.items.map((item) => (
            <article
              key={item.id}
              className="rounded-xl border border-slate-200 p-4 text-sm"
            >
              <div className="flex justify-between gap-3">
                <strong>
                  {item.product?.name ?? item.productId}
                </strong>

                <strong>× {item.quantity}</strong>
              </div>

              <p className="mt-1 text-xs text-slate-500">
                SKU: {item.product?.sku ?? "—"} ·{" "}
                {item.condition} · {item.disposition}
              </p>

              <p className="mt-2 text-xs font-medium text-blue-700 dark:text-blue-300">
                {record.status !== "POSTED" ? "Rencana penanganan; stok belum berubah." : record.type === "PURCHASE" ? "Barang telah dikeluarkan untuk pengembalian ke supplier." : item.disposition === "RESTOCK" ? "Barang telah masuk stok penyimpanan." : item.disposition === "QUARANTINE" ? "Barang berada di lokasi karantina dan tidak tersedia untuk penjualan." : "Barang dicatat sebagai scrap, tidak menambah stok."}
              </p>

              <p className="mt-1 text-xs text-slate-500">
                Location:{" "}
                {item.location?.name ??
                  item.locationId ??
                  "—"}{" "}
                · Batch:{" "}
                {item.batch?.batchNumber ?? "None"}
              </p>

              {item.notes && (
                <p className="mt-2 text-slate-600">
                  {item.notes}
                </p>
              )}
              <ItemInspection record={record} item={item} writable={can(`${record.type === "PURCHASE" ? "purchase-returns" : "sales-returns"}.write`) && ["DRAFT", "PENDING", "APPROVED"].includes(record.status)} />
            </article>
          ))}
        </div>
        {record.status === "POSTED" && <ReturnSettlementPanel id={record.id} type={record.type} />}
        <AttachmentPanel entity="ReturnOrder" entityId={record.id} canWrite={can(`${record.type === "PURCHASE" ? "purchase-returns" : "sales-returns"}.write`)} />
      </aside>
    </div>
  );
}

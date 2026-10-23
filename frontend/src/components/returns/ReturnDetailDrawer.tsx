
"use client";

import { X } from "lucide-react";

import type { ReturnRecord } from "@/types/returns";
import ReturnStatusBadge from "./ReturnStatusBadge";

export default function ReturnDetailDrawer({
  record,
  onClose,
}: {
  record: ReturnRecord;
  onClose: () => void;
}) {
  const source =
    record.type === "PURCHASE"
      ? record.purchaseOrder?.number
      : record.sale?.number;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/40"
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
            </article>
          ))}
        </div>
      </aside>
    </div>
  );
}

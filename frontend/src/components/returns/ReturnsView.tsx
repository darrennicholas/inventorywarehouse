
"use client";

import {
  useCallback,
  useEffect,
  useState,
} from "react";

import {
  ArrowLeft,
  ArrowRight,
  Eye,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";

import { useAuth } from "@/components/auth/AuthProvider";
import { returnService } from "@/services/return.service";

import type {
  ReturnRecord,
  ReturnStatus,
  ReturnType,
} from "@/types/returns";

import ReturnFormModal from "./ReturnFormModal";
import ReturnDetailDrawer from "./ReturnDetailDrawer";
import ReturnStatusBadge from "./ReturnStatusBadge";

export default function ReturnsView({
  type,
}: {
  type: ReturnType;
}) {
  const { can, user } = useAuth();

  const prefix =
    type === "PURCHASE"
      ? "purchase-returns"
      : "sales-returns";

  const canWrite = can(`${prefix}.write`);
  const canApprove = can(`${prefix}.approve`);
  const canDelete = can(`${prefix}.delete`);

  const [rows, setRows] = useState<ReturnRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(
    null
  );
  const [error, setError] = useState("");

  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");

  const [status, setStatus] = useState<
    ReturnStatus | ""
  >("");

  const [selected, setSelected] = useState<
    ReturnRecord | null
  >(null);

  const [formOpen, setFormOpen] = useState(false);

  const [editing, setEditing] = useState<
    ReturnRecord | null
  >(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await returnService.list(type, {
        page,
        pageSize: 20,
        status: status || undefined,
        search: search.trim() || undefined,
      });

      setRows(Array.isArray(response.data) ? response.data : []);
      setTotal(response.total);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Unable to load returns"
      );
    } finally {
      setLoading(false);
    }
  }, [type, page, status, search]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function openDetails(id: string) {
    try {
      const res = await returnService.get(id);
      setSelected(res.data);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Cannot load details"
      );
    }
  }

  async function action(
    row: ReturnRecord,
    kind: "submit" | "approve" | "post" | "cancel"
  ) {
    const message =
      kind === "post"
        ? "Post this return? This will change physical stock and cannot be undone by cancellation."
        : `${kind.toUpperCase()} return ${row.number}?`;

    if (!window.confirm(message)) return;

    setWorking(row.id);
    setError("");

    try {
      if (kind === "cancel") {
        await returnService.cancel(row.id);
      } else {
        await returnService.act(row.id, kind);
      }

      setSelected(null);
      await load();

      window.dispatchEvent(
        new Event("stockflow:notifications")
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : `Unable to ${kind} return`
      );
    } finally {
      setWorking(null);
    }
  }

  const totalPages = Math.max(
    1,
    Math.ceil(total / 20)
  );

  const title =
    type === "PURCHASE"
      ? "Purchase Returns"
      : "Sales Returns";

  return (
    <section className="space-y-5">
      {/* HEADER */}
      <div
        className={`rounded-3xl bg-gradient-to-br ${
          type === "PURCHASE"
            ? "from-indigo-600 to-blue-700"
            : "from-emerald-600 to-teal-700"
        } p-7 text-white shadow-lg`}
      >
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-white/70">
              Inventory Warehouse System
            </p>

            <h1 className="mt-2 text-2xl font-bold">
              {title}
            </h1>

            <p className="mt-1 text-sm text-white/80">
              Track returns from request through
              approval and physical stock posting.
            </p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => void load()}
              className="inline-flex items-center gap-2 rounded-xl bg-white/20 px-4 py-2.5 text-sm font-semibold"
            >
              <RefreshCw size={15} />
              Refresh
            </button>

            {canWrite && (
              <button
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
                className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-slate-900"
              >
                <Plus size={16} />
                New Return
              </button>
            )}
          </div>
        </div>
      </div>

      {/* SUMMARY */}
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          ["Total records", total],
          ["On this page", rows.length],
          [
            "Pending approval",
            rows.filter(
              (x) => x.status === "PENDING"
            ).length,
          ],
        ].map(([label, value]) => (
          <div
            key={label}
            className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm"
          >
            <p className="text-xs text-slate-500">
              {label}
            </p>

            <p className="mt-2 text-2xl font-extrabold text-slate-900">
              {value}
            </p>
          </div>
        ))}
      </div>

      {/* TABLE */}
      <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-5">
          <label className="relative min-w-56 flex-1">
            <Search
              size={16}
              className="absolute left-3 top-3 text-slate-400"
            />

            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search return number..."
              className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-3 text-sm"
            />
          </label>

          <select
            value={status}
            onChange={(e) => {
              setStatus(
                e.target.value as ReturnStatus | ""
              );
              setPage(1);
            }}
            className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm"
          >
            <option value="">All statuses</option>

            {[
              "DRAFT",
              "PENDING",
              "APPROVED",
              "POSTED",
              "CANCELLED",
            ].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {error && (
          <div
            role="alert"
            className="m-4 rounded-xl bg-rose-50 p-4 text-sm text-rose-700"
          >
            {error}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[930px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                {[
                  "Return number",
                  "Source",
                  "Date",
                  "Warehouse",
                  "Items",
                  "Status",
                  "Actions",
                ].map((h) => (
                  <th
                    key={h}
                    className="px-5 py-4"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="hover:bg-slate-50"
                >
                  <td className="px-5 py-4 font-bold text-slate-900">
                    {row.number}
                  </td>

                  <td className="px-5 py-4">
                    {type === "PURCHASE"
                      ? row.purchaseOrder?.number ??
                        "—"
                      : row.sale?.number ?? "—"}
                  </td>

                  <td className="px-5 py-4 text-slate-600">
                    {new Date(
                      row.createdAt
                    ).toLocaleDateString("id-ID")}
                  </td>

                  <td className="px-5 py-4">
                    {row.warehouse?.name ?? "—"}
                  </td>

                  <td className="px-5 py-4">
                    {row.items?.length ?? 0}
                  </td>

                  <td className="px-5 py-4">
                    <ReturnStatusBadge
                      status={row.status}
                    />
                  </td>

                  <td className="px-5 py-4">
                    <div className="flex flex-wrap items-center gap-1">
                      <button
                        title="View details"
                        onClick={() =>
                          void openDetails(row.id)
                        }
                        className="rounded-lg p-2 text-blue-700 hover:bg-blue-50"
                      >
                        <Eye size={17} />
                      </button>

                      {row.status === "DRAFT" &&
                        canWrite && (
                          <>
                            <button
                              onClick={() => {
                                setEditing(row);
                                setFormOpen(true);
                              }}
                              className="rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                            >
                              Edit
                            </button>

                            <button
                              disabled={Boolean(
                                working
                              )}
                              onClick={() =>
                                void action(
                                  row,
                                  "submit"
                                )
                              }
                              className="rounded-lg px-2 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                            >
                              Submit
                            </button>
                          </>
                        )}

                      {row.status === "PENDING" &&
                        canApprove &&
                        row.createdById !==
                          user?.id && (
                          <button
                            disabled={Boolean(
                              working
                            )}
                            onClick={() =>
                              void action(
                                row,
                                "approve"
                              )
                            }
                            className="rounded-lg px-2 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
                          >
                            Approve
                          </button>
                        )}

                      {row.status ===
                        "APPROVED" &&
                        canApprove && (
                          <button
                            disabled={Boolean(
                              working
                            )}
                            onClick={() =>
                              void action(
                                row,
                                "post"
                              )
                            }
                            className="rounded-lg px-2 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50"
                          >
                            Post
                          </button>
                        )}

                      {![
                        "POSTED",
                        "CANCELLED",
                      ].includes(row.status) &&
                        canDelete && (
                          <button
                            title="Cancel return"
                            disabled={Boolean(
                              working
                            )}
                            onClick={() =>
                              void action(
                                row,
                                "cancel"
                              )
                            }
                            className="rounded-lg p-2 text-rose-700 hover:bg-rose-50"
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {loading && (
          <div className="flex justify-center gap-2 p-12 text-sm text-slate-500">
            <LoaderCircle
              size={18}
              className="animate-spin"
            />
            Loading returns...
          </div>
        )}

        {!loading && rows.length === 0 && (
          <p className="p-12 text-center text-sm text-slate-500">
            No returns found.
          </p>
        )}

        {/* PAGINATION */}
        <div className="flex items-center justify-between border-t p-4 text-xs text-slate-500">
          <span>
            Page {page} of {totalPages} · {total}{" "}
            records
          </span>

          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() =>
                setPage((p) => p - 1)
              }
              className="rounded-lg border px-3 py-2 disabled:opacity-40"
            >
              <ArrowLeft size={14} />
            </button>

            <button
              disabled={page >= totalPages}
              onClick={() =>
                setPage((p) => p + 1)
              }
              className="rounded-lg border px-3 py-2 disabled:opacity-40"
            >
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* MODALS */}
      {formOpen && (
        <ReturnFormModal
          type={type}
          editing={editing}
          onClose={() => {
            setFormOpen(false);
            setEditing(null);
          }}
          onSaved={() => {
            setFormOpen(false);
            setEditing(null);
            void load();
          }}
        />
      )}

      {selected && (
        <ReturnDetailDrawer
          record={selected}
          onClose={() =>
            setSelected(null)
          }
        />
      )}
    </section>
  );
}

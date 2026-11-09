
"use client";

import GlobalLoading from "@/components/ui/GlobalLoading";
import GlobalSelect from "@/components/ui/GlobalSelect";
import { confirmAction } from "@/components/ui/GlobalAlert";
import { Eye, Trash2 } from "@/components/ui/ActionIcons";

import {
  useCallback,
  useEffect,
  useState,
} from "react";

import { Plus, RefreshCw, Search } from "lucide-react";

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
import type { NotificationTarget } from "@/types/notification";
import DataPagination from "@/components/ui/DataPagination";
import ActionFeedback from "@/components/ui/ActionFeedback";
import { statusLabel } from "@/lib/ui-labels";

export default function ReturnsView({
  type,
  target = null,
}: {
  type: ReturnType;
  target?: NotificationTarget | null;
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
  const [pageSize, setPageSize] = useState(20);
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
        pageSize,
        status: status || undefined,
        search: search.trim() || undefined,
      });

      setRows(Array.isArray(response.data) ? response.data : []);
      setTotal(response.total);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Retur tidak dapat dimuat."
      );
    } finally {
      setLoading(false);
    }
  }, [type, page, pageSize, status, search]);

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
          : "Rincian retur tidak dapat dimuat."
      );
    }
  }

  useEffect(() => {
    if (!target || target.page !== (type === "PURCHASE" ? "purchase-returns" : "sales-returns")) return;
    let active = true;
    void returnService.get(target.recordId).then((result) => { if (active) setSelected(result.data); }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Retur tidak dapat dibuka."); });
    return () => { active = false; };
  }, [target, type]);

  async function action(
    row: ReturnRecord,
    kind: "submit" | "approve" | "post" | "cancel"
  ) {
    const message =
      kind === "post"
        ? "Proses retur ini? Stok fisik akan berubah dan pembatalan tidak dapat mengurungkan dampaknya."
        : `${{ submit: "Ajukan", approve: "Setujui", post: "Proses", cancel: "Batalkan" }[kind]} retur ${row.number}?`;

    const actionLabel = { submit: "Kirim untuk persetujuan", approve: "Setujui retur", post: "Proses retur", cancel: "Batalkan retur" }[kind];
    if (!await confirmAction(message, { title: actionLabel, confirmLabel: actionLabel, tone: kind === "cancel" || kind === "post" ? "warning" : "info" })) return;

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

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const title =
    type === "PURCHASE"
      ? "Retur pembelian"
      : "Retur penjualan";

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
              Sistem Gudang dan Persediaan
            </p>

            <h1 className="mt-2 text-2xl font-bold">
              {title}
            </h1>

            <p className="mt-1 text-sm text-white/80">
              Pantau retur dari pengajuan, persetujuan, hingga pembukuan stok.
            </p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => void load()}
              className="inline-flex items-center gap-2 rounded-xl bg-white/20 px-4 py-2.5 text-sm font-semibold"
            >
              <RefreshCw size={15} />
              Muat ulang
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
                Buat retur
              </button>
            )}
          </div>
        </div>
      </div>

      {/* SUMMARY */}
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          ["Total retur", total],
          ["Di halaman ini", rows.length],
          [
            "Menunggu persetujuan",
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
              placeholder="Cari nomor retur..."
              className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-3 text-sm"
            />
          </label>

          <GlobalSelect
            value={status}
            onChange={(e) => {
              setStatus(
                e.target.value as ReturnStatus | ""
              );
              setPage(1);
            }}
            className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm"
          >
            <option value="">Semua status</option>

            {[
              "DRAFT",
              "PENDING",
              "APPROVED",
              "POSTED",
              "CANCELLED",
            ].map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </GlobalSelect>
        </div>

        {error && <div className="m-4"><ActionFeedback message={error} tone="error" onDismiss={() => setError("")} /></div>}

        <div className="divide-y divide-slate-100 px-4 md:hidden">
          {loading && <div className="py-6 text-center text-sm text-slate-500"><GlobalLoading label="Memuat retur..." /></div>}
          {!loading && rows.length === 0 && <p className="py-10 text-center text-sm text-slate-500">Tidak ada retur yang cocok.</p>}
          {!loading && rows.map((row) => <article key={row.id} className="space-y-3 py-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-bold text-slate-900">{row.number}</p><p className="mt-1 text-xs text-slate-500">{type === "PURCHASE" ? "Pesanan pembelian" : "Penjualan"} {type === "PURCHASE" ? row.purchaseOrder?.number ?? "—" : row.sale?.number ?? "—"}</p></div><ReturnStatusBadge status={row.status} /></div><dl className="grid grid-cols-2 gap-3 text-xs"><div><dt className="text-slate-400">Gudang</dt><dd className="mt-1 text-slate-700">{row.warehouse?.name ?? "—"}</dd></div><div><dt className="text-slate-400">Jumlah barang</dt><dd className="mt-1 text-slate-700">{row.items?.length ?? 0}</dd></div><div className="col-span-2"><dt className="text-slate-400">Tanggal</dt><dd className="mt-1 text-slate-700">{new Date(row.createdAt).toLocaleDateString("id-ID")}</dd></div></dl><div data-sf-action-column className="flex flex-wrap gap-2 border-t border-slate-100 pt-3"><button type="button" onClick={() => void openDetails(row.id)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700">Lihat rincian</button>{row.status === "DRAFT" && canWrite && <><button type="button" onClick={() => { setEditing(row); setFormOpen(true); }} className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">Ubah</button><button type="button" disabled={Boolean(working)} onClick={() => void action(row, "submit")} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Ajukan</button></>}{row.status === "PENDING" && canApprove && row.createdById !== user?.id && <button type="button" disabled={Boolean(working)} onClick={() => void action(row, "approve")} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Setujui</button>}{row.status === "APPROVED" && canApprove && <button type="button" disabled={Boolean(working)} onClick={() => void action(row, "post")} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Bukukan stok</button>}{!["POSTED", "CANCELLED"].includes(row.status) && canDelete && <button type="button" disabled={Boolean(working)} onClick={() => void action(row, "cancel")} className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 disabled:opacity-50">Batalkan</button>}</div></article>)}
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[930px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                {[
                  "Nomor retur",
                  "Sumber",
                  "Tanggal",
                  "Gudang",
                  "Barang",
                  "Status",
                  "Aksi",
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
                        title="Lihat rincian"
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
                              Ubah
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
                              Ajukan
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
                            Setujui
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
                            Bukukan stok
                          </button>
                        )}

                      {![
                        "POSTED",
                        "CANCELLED",
                      ].includes(row.status) &&
                        canDelete && (
                          <button
                            title="Batalkan retur"
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
            <GlobalLoading label="Memuat retur..." />
          </div>
        )}

        {!loading && rows.length === 0 && (
          <p className="p-12 text-center text-sm text-slate-500">
            Tidak ada retur yang cocok.
          </p>
        )}

        <DataPagination page={page} pageSize={pageSize} total={total} totalPages={totalPages} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} loading={loading} noun="retur" />
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
          onChanged={() => { setSelected(null); void load(); }}
          onClose={() =>
            setSelected(null)
          }
        />
      )}
    </section>
  );
}

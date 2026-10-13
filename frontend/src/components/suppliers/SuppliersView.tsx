
"use client";

import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";

import {
  AlertCircle,
  CheckCircle2,
  Eye,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Truck,
  X,
} from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";

import { useSuppliers } from "@/hooks/useSuppliers";
import { supplierService } from "@/services/supplier.service";

import type {
  Supplier,
  SupplierInput,
} from "@/types/supplier";

const inputClass =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

const labelClass =
  "mb-1.5 block text-xs font-semibold text-slate-700";

type Notice = {
  type: "success" | "error";
  text: string;
} | null;

function initialForm(): SupplierInput {
  return {
    code: "",
    name: "",
    email: null,
    phone: null,
    address: null,
    isActive: true,
  };
}

function formatDate(value: string) {
  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString("id-ID", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

export default function SuppliersView() {
  const { can } = useAuth();
  const canWrite = can("suppliers.write");

  const {
    suppliers,
    loading,
    saving,
    error,
    refresh,
    create,
    update,
    deactivate,
  } = useSuppliers();

  // =====================================
  // TABLE STATE
  // =====================================

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] =
    useState("all");

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // =====================================
  // MODAL STATE
  // =====================================

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] =
    useState<Supplier | null>(null);

  const [viewing, setViewing] =
    useState<Supplier | null>(null);

  const [detailLoading, setDetailLoading] =
    useState(false);

  const [form, setForm] =
    useState<SupplierInput>(initialForm);

  const [formError, setFormError] = useState("");
  const [notice, setNotice] =
    useState<Notice>(null);

  // =====================================
  // SEARCH & STATUS FILTER
  // =====================================

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();

    return suppliers.filter((supplier) => {
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active"
          ? supplier.isActive
          : !supplier.isActive);

      const matchesSearch =
        !keyword ||
        [
          supplier.code,
          supplier.name,
          supplier.email,
          supplier.phone,
          supplier.address,
        ].some((value) =>
          (value ?? "").toLowerCase().includes(keyword)
        );

      return matchesStatus && matchesSearch;
    });
  }, [suppliers, search, statusFilter]);

  // =====================================
  // PAGINATION
  // =====================================

  const totalPages = Math.max(
    1,
    Math.ceil(filtered.length / pageSize)
  );

  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;

  const visible = filtered.slice(
    start,
    start + pageSize
  );

  const showingFrom =
    filtered.length === 0 ? 0 : start + 1;

  const showingTo = Math.min(
    start + pageSize,
    filtered.length
  );

  // =====================================
  // FORM HELPERS
  // =====================================

  function setField<K extends keyof SupplierInput>(
    field: K,
    value: SupplierInput[K]
  ) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function openAdd() {
    setEditing(null);
    setForm(initialForm());
    setFormError("");
    setModalOpen(true);
  }

  function openEdit(supplier: Supplier) {
    setEditing(supplier);

    setForm({
      code: supplier.code,
      name: supplier.name,
      email: supplier.email,
      phone: supplier.phone,
      address: supplier.address,
      isActive: supplier.isActive,
    });

    setFormError("");
    setModalOpen(true);
  }

  function closeModal() {
    if (saving) return;

    setModalOpen(false);
    setEditing(null);
    setFormError("");
  }

  // =====================================
  // ESCAPE KEY
  // =====================================

  useEffect(() => {
    if (!modalOpen && !viewing) return;

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) {
        setModalOpen(false);
        setEditing(null);
        setViewing(null);
        setFormError("");
      }
    }

    window.addEventListener(
      "keydown",
      handleEscape
    );

    return () =>
      window.removeEventListener(
        "keydown",
        handleEscape
      );
  }, [modalOpen, viewing, saving]);

  // =====================================
  // VIEW DETAIL
  // =====================================

  async function openDetail(id: string) {
    setDetailLoading(true);
    setNotice(null);

    try {
      setViewing(await supplierService.detail(id));
    } catch (reason) {
      setNotice({
        type: "error",
        text:
          reason instanceof Error
            ? reason.message
            : "Failed to load supplier",
      });
    } finally {
      setDetailLoading(false);
    }
  }

  // =====================================
  // CREATE / UPDATE
  // =====================================

  async function save(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();
    setFormError("");

    const input: SupplierInput = {
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      email:
        form.email?.trim().toLowerCase() || null,
      phone: form.phone?.trim() || null,
      address: form.address?.trim() || null,
      isActive: form.isActive,
    };

    if (
      !/^[A-Z0-9][A-Z0-9_-]{1,39}$/.test(input.code)
    ) {
      setFormError(
        "Supplier code must be 2–40 characters (letters, numbers, - or _)."
      );
      return;
    }

    if (
      input.name.length < 2 ||
      input.name.length > 120
    ) {
      setFormError(
        "Supplier name must be 2–120 characters."
      );
      return;
    }

    if (
      input.email &&
      input.email.length > 254
    ) {
      setFormError("Email is too long.");
      return;
    }

    try {
      if (editing) {
        await update(editing.id, input);
      } else {
        await create(input);
      }

      setNotice({
        type: "success",
        text: `Supplier ${
          editing ? "updated" : "created"
        } successfully.`,
      });

      setModalOpen(false);
      setEditing(null);
      setSearch("");
      setStatusFilter("all");
      setPage(1);
    } catch (reason) {
      setFormError(
        reason instanceof Error
          ? reason.message
          : "Failed to save supplier"
      );
    }
  }

  // =====================================
  // DEACTIVATE
  // =====================================

  async function handleDeactivate(
    supplier: Supplier
  ) {
    if (saving || !supplier.isActive) return;

    const confirmed = window.confirm(
      `Deactivate supplier "${supplier.name}" (${supplier.code})? The record will be retained.`
    );

    if (!confirmed) return;

    setNotice(null);

    try {
      await deactivate(supplier.id);

      setNotice({
        type: "success",
        text: "Supplier deactivated successfully.",
      });
    } catch (reason) {
      setNotice({
        type: "error",
        text:
          reason instanceof Error
            ? reason.message
            : "Failed to deactivate supplier",
      });
    }
  }

  // =====================================
  // RENDER
  // =====================================

  return (
    <div className="space-y-4">
      {/* NOTIFICATION */}
      {notice && (
        <div
          role={
            notice.type === "error"
              ? "alert"
              : "status"
          }
          className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-sm ${
            notice.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {notice.type === "success" ? (
            <CheckCircle2 size={18} />
          ) : (
            <AlertCircle size={18} />
          )}

          <span className="flex-1">
            {notice.text}
          </span>

          <button
            type="button"
            aria-label="Dismiss message"
            onClick={() => setNotice(null)}
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* API ERROR */}
      {error && (
        <div
          role="alert"
          className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          <AlertCircle size={18} />

          <span className="flex-1">{error}</span>

          <button
            type="button"
            className="font-semibold underline"
            onClick={() => void refresh()}
          >
            Retry
          </button>
        </div>
      )}

      {/* MAIN CARD */}
      <section className="overflow-hidden rounded-2xl border border-[#ebedf2] bg-white shadow-sm">
        {/* HEADER */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 px-5 py-5 sm:px-7">
          <div>
            <h2 className="text-lg font-bold text-[#182237]">
              All Suppliers
            </h2>

            <p className="mt-1 text-xs text-slate-400">
              Manage supplier profiles and contact information
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              title="Refresh"
              aria-label="Refresh suppliers"
              disabled={loading}
              onClick={() => void refresh()}
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw
                size={17}
                className={
                  loading ? "animate-spin" : ""
                }
              />
            </button>

            {canWrite && <button
              type="button"
              onClick={openAdd}
              className="inline-flex items-center gap-2 rounded-full bg-[#3867f6] px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-700"
            >
              <Plus size={17} />
              Add Supplier
            </button>}
          </div>
        </div>

        {/* TOOLBAR */}
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-7">
          <div className="flex items-center gap-2 text-xs text-slate-600">
            Show

            <select
              aria-label="Entries per page"
              value={pageSize}
              onChange={(event) => {
                setPageSize(
                  Number(event.target.value)
                );
                setPage(1);
              }}
              className="rounded-md border border-slate-200 px-2 py-2"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
            </select>

            entries
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Status filter"
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value);
                setPage(1);
              }}
              className="rounded-md border border-slate-200 px-3 py-2 text-xs"
            >
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="inactive">
                Inactive
              </option>
            </select>

            <div className="relative">
              <Search
                size={15}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />

              <input
                type="search"
                aria-label="Search suppliers"
                placeholder="Search suppliers..."
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                className="rounded-md border border-slate-200 py-2 pl-9 pr-3 text-xs outline-none focus:border-blue-500"
              />
            </div>
          </div>
        </div>

        {/* TABLE */}
        <div className="overflow-x-auto px-5 sm:px-7">
          <table className="w-full min-w-[900px] text-left text-xs">
            <thead>
              <tr className="border-b-2 border-slate-200 text-slate-700">
                {[
                  "No.",
                  "Supplier Code",
                  "Supplier Name",
                  "Email",
                  "Phone",
                  "Address",
                  "Status",
                  "Action",
                ].map((heading) => (
                  <th
                    key={heading}
                    className="px-3 py-3 font-bold"
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {!loading &&
                visible.map((supplier, index) => (
                  <tr
                    key={supplier.id}
                    className="hover:bg-[#f8faff]"
                  >
                    <td className="px-3 py-4 text-slate-500">
                      {start + index + 1}
                    </td>

                    <td className="whitespace-nowrap px-3 py-4 font-mono font-semibold text-blue-600">
                      {supplier.code}
                    </td>

                    <td className="px-3 py-4">
                      <div className="flex items-center gap-2">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                          <Truck size={17} />
                        </span>

                        <span className="font-semibold text-slate-800">
                          {supplier.name}
                        </span>
                      </div>
                    </td>

                    <td className="px-3 py-4 text-slate-600">
                      {supplier.email || "—"}
                    </td>

                    <td className="whitespace-nowrap px-3 py-4 text-slate-600">
                      {supplier.phone || "—"}
                    </td>

                    <td className="max-w-[260px] px-3 py-4 text-slate-600">
                      {supplier.address || "—"}
                    </td>

                    <td className="px-3 py-4">
                      <span
                        className={`rounded-full px-3 py-1 font-semibold ${
                          supplier.isActive
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {supplier.isActive
                          ? "Active"
                          : "Inactive"}
                      </span>
                    </td>

                    <td className="whitespace-nowrap px-3 py-4">
                      <button
                        type="button"
                        disabled={detailLoading}
                        title="View"
                        onClick={() =>
                          void openDetail(
                            supplier.id
                          )
                        }
                        className="mr-2 inline-flex items-center gap-1 rounded-md bg-slate-100 px-3 py-2 font-semibold text-slate-700 disabled:opacity-50"
                      >
                        <Eye size={13} />
                        View
                      </button>

                      {canWrite && <button
                        type="button"
                        disabled={saving}
                        onClick={() =>
                          openEdit(supplier)
                        }
                        className="mr-2 inline-flex items-center gap-1 rounded-md bg-[#159fe2] px-3 py-2 font-semibold text-white disabled:opacity-50"
                      >
                        <Pencil size={13} />
                        Edit
                      </button>}

                      {canWrite && <button
                        type="button"
                        disabled={
                          saving ||
                          !supplier.isActive
                        }
                        title="Deactivate"
                        aria-label={`Deactivate ${supplier.name}`}
                        onClick={() =>
                          void handleDeactivate(
                            supplier
                          )
                        }
                        className="inline-flex items-center rounded-md bg-red-500 px-2.5 py-2 text-white disabled:opacity-35"
                      >
                        <Trash2 size={13} />
                      </button>}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>

          {/* LOADING */}
          {loading && (
            <div className="flex items-center justify-center gap-2 py-14 text-sm text-slate-500">
              <LoaderCircle
                size={18}
                className="animate-spin"
              />
              Loading suppliers...
            </div>
          )}

          {/* EMPTY */}
          {!loading &&
            filtered.length === 0 && (
              <div className="py-14 text-center text-sm text-slate-400">
                {search ||
                statusFilter !== "all"
                  ? "No matching suppliers"
                  : "No suppliers yet. Click Add Supplier to begin."}
              </div>
            )}
        </div>

        {/* PAGINATION */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-5 text-xs text-slate-500 sm:px-7">
          <span>
            Showing {showingFrom} to{" "}
            {showingTo} of {filtered.length} entries
          </span>

          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() =>
                setPage(currentPage - 1)
              }
              className="disabled:opacity-35"
            >
              Previous
            </button>

            <span className="rounded-md bg-sky-500 px-3 py-2 font-bold text-white">
              {currentPage}
            </span>

            <span>/ {totalPages}</span>

            <button
              type="button"
              disabled={
                currentPage >= totalPages
              }
              onClick={() =>
                setPage(currentPage + 1)
              }
              className="disabled:opacity-35"
            >
              Next
            </button>
          </div>
        </div>
      </section>

      {/* ================================= */}
      {/* ADD / EDIT MODAL */}
      {/* ================================= */}

      {modalOpen && canWrite && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4"
          onMouseDown={(event) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              closeModal();
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="supplier-form-title"
            className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
              <div>
                <h2
                  id="supplier-form-title"
                  className="text-lg font-bold text-slate-900"
                >
                  {editing
                    ? "Edit Supplier"
                    : "Add New Supplier"}
                </h2>

                <p className="mt-1 text-xs text-slate-400">
                  Supplier master data
                </p>
              </div>

              <button
                type="button"
                disabled={saving}
                onClick={closeModal}
                aria-label="Close"
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"
              >
                <X size={19} />
              </button>
            </div>

            <form
              onSubmit={save}
              className="space-y-4 p-6"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="supplier-code"
                    className={labelClass}
                  >
                    Supplier Code *
                  </label>

                  <input
                    id="supplier-code"
                    autoFocus
                    required
                    maxLength={40}
                    value={form.code}
                    onChange={(event) =>
                      setField(
                        "code",
                        event.target.value
                      )
                    }
                    placeholder="SUP-001"
                    className={inputClass}
                  />
                </div>

                <div>
                  <label
                    htmlFor="supplier-name"
                    className={labelClass}
                  >
                    Supplier Name *
                  </label>

                  <input
                    id="supplier-name"
                    required
                    maxLength={120}
                    value={form.name}
                    onChange={(event) =>
                      setField(
                        "name",
                        event.target.value
                      )
                    }
                    placeholder="PT Sumber Teknologi"
                    className={inputClass}
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="supplier-email"
                    className={labelClass}
                  >
                    Email
                  </label>

                  <input
                    id="supplier-email"
                    type="email"
                    maxLength={254}
                    value={form.email ?? ""}
                    onChange={(event) =>
                      setField(
                        "email",
                        event.target.value || null
                      )
                    }
                    placeholder="sales@example.com"
                    className={inputClass}
                  />
                </div>

                <div>
                  <label
                    htmlFor="supplier-phone"
                    className={labelClass}
                  >
                    Phone
                  </label>

                  <input
                    id="supplier-phone"
                    type="tel"
                    maxLength={30}
                    value={form.phone ?? ""}
                    onChange={(event) =>
                      setField(
                        "phone",
                        event.target.value || null
                      )
                    }
                    placeholder="021-12345678"
                    className={inputClass}
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="supplier-address"
                  className={labelClass}
                >
                  Address
                </label>

                <textarea
                  id="supplier-address"
                  rows={3}
                  maxLength={500}
                  value={form.address ?? ""}
                  onChange={(event) =>
                    setField(
                      "address",
                      event.target.value || null
                    )
                  }
                  placeholder="Enter supplier address..."
                  className={inputClass}
                />
              </div>

              <div>
                <label
                  htmlFor="supplier-status"
                  className={labelClass}
                >
                  Status
                </label>

                <select
                  id="supplier-status"
                  value={
                    form.isActive
                      ? "active"
                      : "inactive"
                  }
                  onChange={(event) =>
                    setField(
                      "isActive",
                      event.target.value ===
                        "active"
                    )
                  }
                  className={inputClass}
                >
                  <option value="active">
                    Active
                  </option>

                  <option value="inactive">
                    Inactive
                  </option>
                </select>
              </div>

              {formError && (
                <div
                  role="alert"
                  className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-xs text-red-700"
                >
                  <AlertCircle size={16} />
                  {formError}
                </div>
              )}

              <div className="flex justify-end gap-3 border-t border-slate-100 pt-5">
                <button
                  type="button"
                  disabled={saving}
                  onClick={closeModal}
                  className="rounded-lg border border-slate-200 px-5 py-2.5 text-xs font-semibold text-slate-700 disabled:opacity-50"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#3867f6] px-5 py-2.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {saving ? (
                    <LoaderCircle
                      size={16}
                      className="animate-spin"
                    />
                  ) : editing ? (
                    <Pencil size={16} />
                  ) : (
                    <Plus size={16} />
                  )}

                  {saving
                    ? "Saving..."
                    : editing
                      ? "Update Supplier"
                      : "Save Supplier"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================================= */}
      {/* DETAIL MODAL */}
      {/* ================================= */}

      {viewing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4"
          onMouseDown={(event) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              setViewing(null);
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="supplier-detail-title"
            className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
              <h2
                id="supplier-detail-title"
                className="text-lg font-bold text-slate-900"
              >
                Supplier Details
              </h2>

              <button
                type="button"
                aria-label="Close details"
                onClick={() =>
                  setViewing(null)
                }
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
              >
                <X size={19} />
              </button>
            </div>

            <div className="space-y-3 p-6 text-sm">
              {([
                [
                  "Supplier Code",
                  viewing.code,
                ],
                [
                  "Supplier Name",
                  viewing.name,
                ],
                [
                  "Email",
                  viewing.email || "—",
                ],
                [
                  "Phone",
                  viewing.phone || "—",
                ],
                [
                  "Address",
                  viewing.address || "—",
                ],
                [
                  "Status",
                  viewing.isActive
                    ? "Active"
                    : "Inactive",
                ],
                [
                  "Created At",
                  formatDate(viewing.createdAt),
                ],
                [
                  "Updated At",
                  formatDate(viewing.updatedAt),
                ],
              ] as [string, string][]).map(
                ([label, value]) => (
                  <div
                    key={label}
                    className="grid grid-cols-[110px_1fr] gap-3 border-b border-slate-100 pb-3"
                  >
                    <span className="text-slate-500">
                      {label}
                    </span>

                    <span className="break-words font-semibold text-slate-800">
                      {value}
                    </span>
                  </div>
                )
              )}

              <div className="flex justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() =>
                    setViewing(null)
                  }
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold"
                >
                  Close
                </button>

                {canWrite && <button
                  type="button"
                  onClick={() => {
                    const supplier = viewing;
                    setViewing(null);
                    openEdit(supplier);
                  }}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#3867f6] px-4 py-2 text-xs font-semibold text-white"
                >
                  <Pencil size={14} />
                  Edit Supplier
                </button>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

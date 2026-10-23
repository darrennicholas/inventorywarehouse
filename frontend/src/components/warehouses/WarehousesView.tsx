
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
  Download,
  Eye,
  LoaderCircle,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Warehouse as WarehouseIcon,
  X,
} from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";

import { useWarehouses } from "@/hooks/useWarehouses";
import { warehouseService } from "@/services/warehouse.service";
import WarehouseLocationsPanel from "@/components/warehouses/WarehouseLocationsPanel";

import type {
  Warehouse,
  CreateWarehouseInput,
} from "@/types/warehouse";

// ======================================
// HELPERS
// ======================================

function formatDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

const inputClass =
  "w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

const labelClass =
  "mb-2 block text-xs font-semibold text-slate-700";

type Notice = {
  type: "success" | "error";
  message: string;
} | null;

// ======================================
// MAIN COMPONENT
// ======================================

export default function WarehousesView() {
  const { can } = useAuth();
  const canWrite = can("warehouses.write");

  const {
    warehouses,
    loading,
    saving,
    error,
    fetchWarehouses,
    createWarehouse,
    updateWarehouse,
    deactivateWarehouse,
  } = useWarehouses();

  // TABLE
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);

  // ADD / EDIT MODAL
  const [modalOpen, setModalOpen] = useState(false);

  const [editing, setEditing] =
    useState<Warehouse | null>(null);

  // DETAIL MODAL
  const [viewing, setViewing] =
    useState<Warehouse | null>(null);

  const [detailLoading, setDetailLoading] =
    useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // FORM
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [isActive, setIsActive] = useState(true);

  const [formError, setFormError] = useState("");
  const [notice, setNotice] =
    useState<Notice>(null);

  async function downloadSheet(warehouse: Warehouse) {
    setDownloadingId(warehouse.id);
    try {
      await warehouseService.downloadStockCountSheet(warehouse);
      setNotice({ type: "success", message: `Stock-count PDF for ${warehouse.name} downloaded.` });
    } catch (reason) {
      setNotice({ type: "error", message: reason instanceof Error ? reason.message : "Failed to download PDF" });
    } finally {
      setDownloadingId(null);
    }
  }

  // ====================================
  // SEARCH & FILTER
  // ====================================

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();

    if (!keyword) {
      return warehouses;
    }

    return warehouses.filter(
      (warehouse) =>
        warehouse.code.toLowerCase().includes(keyword) ||
        warehouse.name.toLowerCase().includes(keyword) ||
        (warehouse.address ?? "")
          .toLowerCase()
          .includes(keyword)
    );
  }, [warehouses, search]);

  // ====================================
  // PAGINATION
  // ====================================

  const totalPages = Math.max(
    1,
    Math.ceil(filtered.length / pageSize)
  );

  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * pageSize;

  const visible = filtered.slice(
    startIndex,
    startIndex + pageSize
  );

  const showingFrom =
    filtered.length === 0 ? 0 : startIndex + 1;

  const showingTo = Math.min(
    startIndex + pageSize,
    filtered.length
  );

  // ====================================
  // OPEN ADD MODAL
  // ====================================

  function openAdd() {
    setEditing(null);
    setCode("");
    setName("");
    setAddress("");
    setIsActive(true);
    setFormError("");
    setModalOpen(true);
  }

  // ====================================
  // OPEN EDIT MODAL
  // ====================================

  function openEdit(warehouse: Warehouse) {
    setEditing(warehouse);
    setCode(warehouse.code);
    setName(warehouse.name);
    setAddress(warehouse.address ?? "");
    setIsActive(warehouse.isActive);
    setFormError("");
    setModalOpen(true);
  }

  // ====================================
  // CLOSE MODAL
  // ====================================

  function closeModal() {
    if (saving) return;

    setModalOpen(false);
    setEditing(null);
    setFormError("");
  }

  // ====================================
  // DETAIL WAREHOUSE
  // ====================================

  async function openDetail(id: string) {
    setNotice(null);
    setDetailLoading(true);

    try {
      const data = await warehouseService.getById(id);
      setViewing(data);
    } catch (err) {
      setNotice({
        type: "error",
        message:
          err instanceof Error
            ? err.message
            : "Failed to load warehouse details",
      });
    } finally {
      setDetailLoading(false);
    }
  }

  // ====================================
  // ESCAPE KEY
  // ====================================

  useEffect(() => {
    if (!modalOpen && !viewing) return;

    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || saving) return;

      setModalOpen(false);
      setEditing(null);
      setFormError("");
      setViewing(null);
    }

    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [modalOpen, viewing, saving]);

  // ====================================
  // CREATE / UPDATE
  // ====================================

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    const cleanCode = code.trim().toUpperCase();
    const cleanName = name.trim();
    const cleanAddress = address.trim();

    if (!/^[A-Z0-9][A-Z0-9_-]{1,29}$/.test(cleanCode)) {
      setFormError(
        "Warehouse code must contain 2–30 letters, numbers, - or _."
      );
      return;
    }

    if (cleanName.length < 2) {
      setFormError(
        "Warehouse name must contain at least 2 characters."
      );
      return;
    }

    if (cleanAddress.length > 500) {
      setFormError(
        "Address cannot exceed 500 characters."
      );
      return;
    }

    const payload: CreateWarehouseInput = {
      code: cleanCode,
      name: cleanName,
      address: cleanAddress || null,
      isActive,
    };

    setFormError("");

    try {
      if (editing) {
        await updateWarehouse(editing.id, payload);

        setNotice({
          type: "success",
          message: `Warehouse "${cleanName}" updated successfully.`,
        });
      } else {
        await createWarehouse(payload);

        setNotice({
          type: "success",
          message: `Warehouse "${cleanName}" created successfully.`,
        });
      }

      setModalOpen(false);
      setEditing(null);
      setSearch("");
      setPage(1);
    } catch (err) {
      setFormError(
        err instanceof Error
          ? err.message
          : "Failed to save warehouse"
      );
    }
  }

  // ====================================
  // SOFT DELETE
  // ====================================

  async function handleDeactivate(
    warehouse: Warehouse
  ) {
    if (!warehouse.isActive) return;

    const confirmed = window.confirm(
      `Nonaktifkan gudang "${warehouse.name}" (${warehouse.code})? Data tidak akan dihapus permanen.`
    );

    if (!confirmed) return;

    setNotice(null);

    try {
      await deactivateWarehouse(warehouse.id);

      setNotice({
        type: "success",
        message: `Warehouse "${warehouse.name}" deactivated successfully.`,
      });
    } catch (err) {
      setNotice({
        type: "error",
        message:
          err instanceof Error
            ? err.message
            : "Failed to deactivate warehouse",
      });
    }
  }

  // ====================================
  // RENDER
  // ====================================

  return (
    <div className="space-y-4">
      {/* NOTICE */}
      {notice && (
        <div
          role="status"
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
            {notice.message}
          </span>

          <button
            type="button"
            aria-label="Dismiss notification"
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
            onClick={() => void fetchWarehouses()}
            className="font-semibold underline"
          >
            Retry
          </button>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-[1.3fr_1fr_1fr]">
        <div className="relative overflow-hidden rounded-2xl bg-slate-900 p-5 text-white shadow-sm"><div className="absolute -right-8 -top-10 h-28 w-28 rounded-full border-[18px] border-cyan-400/20" /><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-300">Storage network</p><p className="mt-2 text-2xl font-bold">{warehouses.length} locations</p><p className="mt-1 text-xs text-slate-400">Download a stock-count PDF from any warehouse row.</p></div>
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-5 dark:border-emerald-900 dark:bg-emerald-950/30"><p className="text-xs font-semibold text-emerald-700">Active locations</p><p className="mt-2 text-2xl font-bold text-slate-900">{warehouses.filter((warehouse) => warehouse.isActive).length}</p></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-xs font-semibold text-slate-500">Inactive locations</p><p className="mt-2 text-2xl font-bold text-slate-900">{warehouses.filter((warehouse) => !warehouse.isActive).length}</p></div>
      </div>

      {/* MAIN CARD */}
      <section className="overflow-hidden rounded-2xl border border-[#ebedf2] bg-white shadow-sm">
        {/* HEADER */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 px-5 py-5 sm:px-7">
          <div>
            <h2 className="text-lg font-bold text-[#182237]">
              All Warehouses
            </h2>

            <p className="mt-1 text-xs text-slate-400">
              Manage warehouse master data and storage locations
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={loading}
              onClick={() => void fetchWarehouses()}
              title="Refresh warehouses"
              aria-label="Refresh warehouses"
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw
                size={17}
                className={loading ? "animate-spin" : ""}
              />
            </button>

            {canWrite && <button
              type="button"
              onClick={openAdd}
              className="inline-flex items-center gap-2 rounded-full bg-[#3867f6] px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-700"
            >
              <Plus size={17} />
              Add Warehouse
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
                setPageSize(Number(event.target.value));
                setPage(1);
              }}
              className="rounded-md border border-slate-200 bg-white px-2 py-2"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
            </select>

            entries
          </div>

          <div className="flex items-center gap-2">
            <label
              htmlFor="warehouse-search"
              className="text-xs text-slate-600"
            >
              Search:
            </label>

            <div className="relative">
              <Search
                size={15}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />

              <input
                id="warehouse-search"
                type="search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="Code, name, address..."
                className="w-full rounded-md border border-slate-200 py-2 pl-9 pr-3 text-xs outline-none focus:border-blue-500"
              />
            </div>
          </div>
        </div>

        {/* TABLE */}
        <div className="overflow-x-auto px-5 sm:px-7">
          <table className="w-full min-w-[850px] text-left text-xs">
            <thead>
              <tr className="border-b-2 border-slate-200 text-slate-700">
                {[
                  "No.",
                  "Code",
                  "Warehouse Name",
                  "Address",
                  "Status",
                  "Created",
                  "Action",
                ].map((heading) => (
                  <th
                    key={heading}
                    className="whitespace-nowrap px-3 py-3 font-bold"
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {!loading &&
                visible.map((warehouse, index) => (
                  <tr
                    key={warehouse.id}
                    className="hover:bg-[#f8faff]"
                  >
                    {/* NO */}
                    <td className="px-3 py-4 text-slate-500">
                      {startIndex + index + 1}
                    </td>

                    {/* CODE */}
                    <td className="whitespace-nowrap px-3 py-4 font-mono font-semibold text-blue-600">
                      {warehouse.code}
                    </td>

                    {/* NAME */}
                    <td className="px-3 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                          <WarehouseIcon size={18} />
                        </div>

                        <span className="font-semibold text-slate-800">
                          {warehouse.name}
                        </span>
                      </div>
                    </td>

                    {/* ADDRESS */}
                    <td className="max-w-[270px] px-3 py-4 text-slate-500">
                      <div className="flex items-start gap-1.5">
                        <MapPin
                          size={14}
                          className="mt-0.5 shrink-0"
                        />
                        <span>
                          {warehouse.address || "—"}
                        </span>
                      </div>
                    </td>

                    {/* STATUS */}
                    <td className="px-3 py-4">
                      <span
                        className={`inline-block rounded-full px-3 py-1 font-semibold ${
                          warehouse.isActive
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {warehouse.isActive
                          ? "Active"
                          : "Inactive"}
                      </span>
                    </td>

                    {/* CREATED */}
                    <td className="whitespace-nowrap px-3 py-4 text-slate-500">
                      {formatDate(warehouse.createdAt)}
                    </td>

                    {/* ACTION */}
                    <td className="whitespace-nowrap px-3 py-4">
                      <button
                        type="button"
                        disabled={detailLoading}
                        onClick={() =>
                          void openDetail(warehouse.id)
                        }
                        title="View Details"
                        aria-label={`View ${warehouse.name}`}
                        className="mr-2 inline-flex items-center gap-1 rounded-md bg-slate-100 px-3 py-2 font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-50"
                      >
                        <Eye size={13} />
                        View
                      </button>

                      <button
                        type="button"
                        disabled={downloadingId === warehouse.id}
                        onClick={() => void downloadSheet(warehouse)}
                        title="Download physical stock-count PDF"
                        className="mr-2 inline-flex items-center gap-1 rounded-md bg-violet-50 px-3 py-2 font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-50"
                      >
                        {downloadingId === warehouse.id ? <LoaderCircle size={13} className="animate-spin" /> : <Download size={13} />}
                        PDF
                      </button>

                      {canWrite && <button
                        type="button"
                        disabled={saving}
                        onClick={() => openEdit(warehouse)}
                        className="mr-2 inline-flex items-center gap-1 rounded-md bg-[#159fe2] px-3 py-2 font-semibold text-white disabled:opacity-50"
                      >
                        <Pencil size={13} />
                        Edit
                      </button>}

                      {canWrite && <button
                        type="button"
                        disabled={saving || !warehouse.isActive}
                        onClick={() =>
                          void handleDeactivate(warehouse)
                        }
                        title="Deactivate Warehouse"
                        aria-label={`Deactivate ${warehouse.name}`}
                        className="inline-flex items-center gap-1 rounded-md bg-red-500 px-2.5 py-2 font-semibold text-white disabled:opacity-35"
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
              Loading warehouses...
            </div>
          )}

          {/* EMPTY STATE */}
          {!loading && filtered.length === 0 && (
            <div className="flex flex-col items-center py-14 text-center">
              <WarehouseIcon
                size={36}
                className="text-slate-300"
              />

              <p className="mt-3 text-sm font-semibold text-slate-700">
                {search
                  ? "No matching warehouses"
                  : "No warehouses found"}
              </p>

              <p className="mt-1 text-xs text-slate-400">
                {search
                  ? "Try another search keyword."
                  : "Add your first warehouse to get started."}
              </p>

              {!search && canWrite && (
                <button
                  type="button"
                  onClick={openAdd}
                  className="mt-5 rounded-lg bg-[#3867f6] px-4 py-2.5 text-xs font-semibold text-white"
                >
                  Add First Warehouse
                </button>
              )}
            </div>
          )}
        </div>

        {/* PAGINATION */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-5 text-xs text-slate-500 sm:px-7">
          <p>
            Showing {showingFrom} to {showingTo} of{" "}
            {filtered.length} entries
          </p>

          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setPage(safePage - 1)}
              className="disabled:opacity-35"
            >
              Previous
            </button>

            <span className="rounded-md bg-sky-500 px-3 py-2 font-bold text-white">
              {safePage}
            </span>

            <span>/ {totalPages}</span>

            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => setPage(safePage + 1)}
              className="disabled:opacity-35"
            >
              Next
            </button>
          </div>
        </div>
      </section>

      {/* ================================= */}
      {/* ADD / EDIT WAREHOUSE MODAL */}
      {/* ================================= */}

      {modalOpen && canWrite && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeModal();
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="warehouse-modal-title"
            className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl"
          >
            {/* MODAL HEADER */}
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
              <div>
                <h2
                  id="warehouse-modal-title"
                  className="text-lg font-bold text-slate-900"
                >
                  {editing
                    ? "Edit Warehouse"
                    : "Add New Warehouse"}
                </h2>

                <p className="mt-1 text-xs text-slate-400">
                  {editing
                    ? "Update warehouse information."
                    : "Register a new storage location."}
                </p>
              </div>

              <button
                type="button"
                disabled={saving}
                onClick={closeModal}
                aria-label="Close modal"
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 disabled:opacity-50"
              >
                <X size={19} />
              </button>
            </div>

            {/* FORM */}
            <form
              onSubmit={handleSubmit}
              className="space-y-5 p-6"
            >
              {/* CODE */}
              <div>
                <label
                  htmlFor="warehouse-code"
                  className={labelClass}
                >
                  Warehouse Code *
                </label>

                <input
                  id="warehouse-code"
                  type="text"
                  value={code}
                  onChange={(event) =>
                    setCode(event.target.value)
                  }
                  maxLength={30}
                  required
                  autoFocus
                  placeholder="e.g. WH-JKT"
                  className={inputClass}
                />
              </div>

              {/* NAME */}
              <div>
                <label
                  htmlFor="warehouse-name"
                  className={labelClass}
                >
                  Warehouse Name *
                </label>

                <input
                  id="warehouse-name"
                  type="text"
                  value={name}
                  onChange={(event) =>
                    setName(event.target.value)
                  }
                  maxLength={120}
                  required
                  placeholder="e.g. Jakarta Main Warehouse"
                  className={inputClass}
                />
              </div>

              {/* ADDRESS */}
              <div>
                <label
                  htmlFor="warehouse-address"
                  className={labelClass}
                >
                  Warehouse Address
                </label>

                <textarea
                  id="warehouse-address"
                  value={address}
                  onChange={(event) =>
                    setAddress(event.target.value)
                  }
                  maxLength={500}
                  rows={3}
                  placeholder="Enter warehouse address..."
                  className={inputClass}
                />
              </div>

              {/* STATUS */}
              <div>
                <label
                  htmlFor="warehouse-status"
                  className={labelClass}
                >
                  Status
                </label>

                <select
                  id="warehouse-status"
                  value={isActive ? "active" : "inactive"}
                  onChange={(event) =>
                    setIsActive(
                      event.target.value === "active"
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

              {/* VALIDATION ERROR */}
              {formError && (
                <div
                  role="alert"
                  className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-xs text-red-700"
                >
                  <AlertCircle size={17} />
                  {formError}
                </div>
              )}

              {/* FOOTER */}
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
                  className="inline-flex items-center gap-2 rounded-lg bg-[#3867f6] px-5 py-2.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
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
                      ? "Update Warehouse"
                      : "Save Warehouse"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================================= */}
      {/* WAREHOUSE DETAIL MODAL */}
      {/* ================================= */}

      {viewing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setViewing(null);
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="warehouse-detail-title"
            className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
              <div>
                <h2
                  id="warehouse-detail-title"
                  className="text-lg font-bold text-slate-900"
                >
                  Warehouse Details
                </h2>

                <p className="mt-1 text-xs text-slate-400">
                  Read-only warehouse information
                </p>
              </div>

              <button
                type="button"
                onClick={() => setViewing(null)}
                aria-label="Close details"
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
              >
                <X size={19} />
              </button>
            </div>

            <div className="space-y-4 p-6 text-sm">
              {[
                ["Warehouse Code", viewing.code],
                ["Warehouse Name", viewing.name],
                ["Address", viewing.address || "—"],
                [
                  "Status",
                  viewing.isActive ? "Active" : "Inactive",
                ],
                [
                  "Created At",
                  new Date(viewing.createdAt).toLocaleString("id-ID"),
                ],
                [
                  "Updated At",
                  new Date(viewing.updatedAt).toLocaleString("id-ID"),
                ],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="grid grid-cols-[130px_1fr] gap-3 border-b border-slate-100 pb-3"
                >
                  <span className="text-slate-500">
                    {label}
                  </span>

                  <span className="break-words font-semibold text-slate-800">
                    {value}
                  </span>
                </div>
              ))}

              <WarehouseLocationsPanel warehouseId={viewing.id} canWrite={canWrite} />

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setViewing(null)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700"
                >
                  Close
                </button>

                {canWrite && <button
                  type="button"
                  onClick={() => {
                    const warehouse = viewing;
                    setViewing(null);
                    openEdit(warehouse);
                  }}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#3867f6] px-4 py-2 text-xs font-semibold text-white"
                >
                  <Pencil size={14} />
                  Edit Warehouse
                </button>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

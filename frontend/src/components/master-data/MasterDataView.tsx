
"use client";

import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";

import {
  AlertCircle,
  Boxes,
  CheckCircle2,
  Eye,
  LoaderCircle,
  LayoutGrid,
  List,
  Pencil,
  Plus,
  RefreshCw,
  Ruler,
  Search,
  Trash2,
  X,
} from "lucide-react";

import { brandService, unitService } from "@/services/master.service";
import { useMasterData } from "@/hooks/useMasterData";
import { useAuth } from "@/components/auth/AuthProvider";

import type { MasterRecord } from "@/types/master";

type Props = {
  kind: "brand" | "unit";
};

function formatDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "—";

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

export default function MasterDataView({ kind }: Props) {
  const isUnit = kind === "unit";
  const moduleName = isUnit ? "units" : "brands";
  const { can } = useAuth();
  const canWrite = can(`${moduleName}.write`);
  const canDelete = can(`${moduleName}.delete`);
  const api = isUnit ? unitService : brandService;

  const {
    rows,
    loading,
    saving,
    error,
    refresh,
    create,
    update,
    deactivate,
  } = useMasterData(api);

  const title = isUnit ? "Units" : "Brands";
  const ItemIcon = isUnit ? Ruler : Boxes;

  // Table
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const [viewMode, setViewMode] = useState<"table" | "cards">(isUnit ? "cards" : "table");

  // Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] =
    useState<MasterRecord | null>(null);
  const [viewing, setViewing] = useState<MasterRecord | null>(null);

  // Form
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [isActive, setIsActive] = useState(true);

  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");

  // =====================================
  // FILTER
  // =====================================

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();

    if (!keyword) return rows;

    return rows.filter(item =>
      item.name.toLowerCase().includes(keyword) ||
      (item.code ?? "").toLowerCase().includes(keyword)
    );
  }, [rows, search]);

  // =====================================
  // PAGINATION
  // =====================================

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

  // =====================================
  // MODAL FUNCTIONS
  // =====================================

  function openAdd() {
    setEditing(null);
    setCode("");
    setName("");
    setIsActive(true);
    setFormError("");
    setModalOpen(true);
  }

  function openEdit(item: MasterRecord) {
    setEditing(item);
    setCode(item.code ?? "");
    setName(item.name);
    setIsActive(item.isActive);
    setFormError("");
    setModalOpen(true);
  }

  function closeModal() {
    if (saving) return;

    setModalOpen(false);
    setEditing(null);
    setFormError("");
  }

  useEffect(() => {
    if (!modalOpen) return;

    function onEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) {
        setModalOpen(false);
        setEditing(null);
        setFormError("");
      }
    }

    window.addEventListener("keydown", onEscape);

    return () => {
      window.removeEventListener("keydown", onEscape);
    };
  }, [modalOpen, saving]);

  // =====================================
  // SAVE
  // =====================================

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    const cleanName = name.trim();
    const cleanCode = code.trim().toUpperCase();

    if (cleanName.length < 2) {
      setFormError(
        "Name must contain at least 2 characters."
      );
      return;
    }

    if (
      isUnit &&
      !/^[A-Z0-9_-]{1,20}$/.test(cleanCode)
    ) {
      setFormError(
        "Unit code must contain 1–20 letters, numbers, - or _."
      );
      return;
    }

    setFormError("");

    const payload = {
      name: cleanName,
      isActive,
      ...(isUnit ? { code: cleanCode } : {}),
    };

    try {
      if (editing) {
        await update(editing.id, payload);

        setNotice(
          `${isUnit ? "Unit" : "Brand"} updated successfully.`
        );
      } else {
        await create(payload);

        setNotice(
          `${isUnit ? "Unit" : "Brand"} created successfully.`
        );
      }

      setActionError("");
      setModalOpen(false);
      setEditing(null);
      setSearch("");
      setPage(1);
    } catch (err) {
      setFormError(
        err instanceof Error
          ? err.message
          : "Failed to save data"
      );
    }
  }

  // =====================================
  // DEACTIVATE
  // =====================================

  async function handleDeactivate(item: MasterRecord) {
    const confirmed = window.confirm(
      `Nonaktifkan ${isUnit ? "Unit" : "Brand"} "${item.name}"? Data tidak akan dihapus permanen.`
    );

    if (!confirmed) return;

    setActionError("");
    setNotice("");

    try {
      await deactivate(item.id);

      setNotice(
        `${isUnit ? "Unit" : "Brand"} deactivated successfully.`
      );
    } catch (err) {
      setActionError(
        err instanceof Error
          ? err.message
          : "Failed to deactivate data"
      );
    }
  }

  // =====================================
  // RENDER
  // =====================================

  return (
    <div className="space-y-4">
      {/* SUCCESS NOTICE */}
      {notice && (
        <div
          role="status"
          className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
        >
          <CheckCircle2 size={18} />
          <span className="flex-1">{notice}</span>
          <button
            type="button"
            aria-label="Dismiss message"
            onClick={() => setNotice("")}
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* ERROR NOTICE */}
      {(error || actionError) && (
        <div
          role="alert"
          className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          <AlertCircle size={18} />
          <span className="flex-1">
            {actionError || error}
          </span>

          {error && (
            <button
              type="button"
              onClick={() => void refresh()}
              className="font-semibold underline"
            >
              Retry
            </button>
          )}
        </div>
      )}

      {/* MAIN CARD */}
      <section className="overflow-hidden rounded-2xl border border-[#ebedf2] bg-white shadow-sm">
        {/* CARD HEADER */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 px-5 py-5 sm:px-7">
          <div>
            <h2 className="text-lg font-bold text-[#182237]">
              All {title}
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              Manage {title.toLowerCase()} registered
              in StockFlow
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-1">
              <button type="button" onClick={() => setViewMode("table")} title="Table view" className={`rounded-md p-1.5 ${viewMode === "table" ? "bg-white text-blue-600 shadow-sm" : "text-slate-400"}`}><List size={15} /></button>
              <button type="button" onClick={() => setViewMode("cards")} title="Card view" className={`rounded-md p-1.5 ${viewMode === "cards" ? "bg-white text-blue-600 shadow-sm" : "text-slate-400"}`}><LayoutGrid size={15} /></button>
            </div>
            <button
              type="button"
              disabled={loading}
              onClick={() => void refresh()}
              aria-label={`Refresh ${title}`}
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
              Add {title}
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
              onChange={e => {
                setPageSize(Number(e.target.value));
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

          <div className="flex items-center gap-2">
            <label
              htmlFor={`${kind}-search`}
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
                id={`${kind}-search`}
                type="search"
                value={search}
                onChange={e => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder={`Search ${title.toLowerCase()}...`}
                className="w-full rounded-md border border-slate-200 py-2 pl-9 pr-3 text-xs outline-none focus:border-blue-500"
              />
            </div>
          </div>
        </div>

        {/* TABLE */}
        {viewMode === "table" && <div className="overflow-x-auto px-5 sm:px-7">
          <table className="w-full min-w-[650px] text-left text-xs">
            <thead>
              <tr className="border-b-2 border-slate-200 text-slate-700">
                <th className="px-3 py-3">No.</th>
                {isUnit && (
                  <th className="px-3 py-3">
                    Unit Code
                  </th>
                )}
                <th className="px-3 py-3">
                  {isUnit ? "Unit Name" : "Brand Name"}
                </th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Created</th>
                <th className="px-3 py-3">Action</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {!loading && visible.map((item, index) => (
                <tr
                  key={item.id}
                  className="hover:bg-[#f8faff]"
                >
                  <td className="px-3 py-4 text-slate-500">
                    {startIndex + index + 1}
                  </td>

                  {isUnit && (
                    <td className="px-3 py-4 font-mono font-semibold text-slate-700">
                      {item.code ?? "—"}
                    </td>
                  )}

                  <td className="px-3 py-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                        <ItemIcon size={17} />
                      </div>
                      <span className="font-semibold text-slate-800">
                        {item.name}
                      </span>
                    </div>
                  </td>

                  <td className="px-3 py-4">
                    <span
                      className={`rounded-full px-3 py-1 font-semibold ${
                        item.isActive
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {item.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>

                  <td className="whitespace-nowrap px-3 py-4 text-slate-500">
                    {formatDate(item.createdAt)}
                  </td>

                  <td className="whitespace-nowrap px-3 py-4">
                    <button
                      type="button"
                      onClick={() => setViewing(item)}
                      className="mr-2 inline-flex items-center gap-1 rounded-md border border-slate-200 px-3 py-2 font-semibold text-slate-600 hover:bg-slate-50"
                    >
                      <Eye size={13} />
                      View
                    </button>
                    {canWrite && <button
                      type="button"
                      disabled={saving}
                      onClick={() => openEdit(item)}
                      className="mr-2 inline-flex items-center gap-1 rounded-md bg-[#159fe2] px-3 py-2 font-semibold text-white disabled:opacity-50"
                    >
                      <Pencil size={13} />
                      Edit
                    </button>}

                    {canDelete && <button
                      type="button"
                      disabled={saving || !item.isActive}
                      onClick={() =>
                        void handleDeactivate(item)
                      }
                      aria-label={`Deactivate ${item.name}`}
                      title="Deactivate"
                      className="inline-flex items-center gap-1 rounded-md bg-red-500 px-2.5 py-2 font-semibold text-white disabled:opacity-35"
                    >
                      <Trash2 size={13} />
                      Delete
                    </button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {loading && (
            <div className="flex items-center justify-center gap-2 py-14 text-sm text-slate-500">
              <LoaderCircle
                size={18}
                className="animate-spin"
              />
              Loading {title.toLowerCase()}...
            </div>
          )}

          {!loading && filtered.length === 0 && (
            <div className="flex flex-col items-center py-14 text-center">
              <ItemIcon
                size={35}
                className="text-slate-300"
              />

              <p className="mt-3 text-sm font-semibold text-slate-700">
                {search
                  ? `No matching ${title.toLowerCase()}`
                  : `No ${title.toLowerCase()} found`}
              </p>

              {!search && canWrite && (
                <button
                  type="button"
                  onClick={openAdd}
                  className="mt-5 rounded-lg bg-[#3867f6] px-4 py-2.5 text-xs font-semibold text-white"
                >
                  Add First {isUnit ? "Unit" : "Brand"}
                </button>
              )}
            </div>
          )}
        </div>}

        {viewMode === "cards" && !loading && <div className={`grid gap-4 px-5 pb-6 sm:px-7 ${isUnit ? "sm:grid-cols-2 xl:grid-cols-4" : "sm:grid-cols-2 xl:grid-cols-3"}`}>
          {visible.map((item, index) => <article key={item.id} className={`group relative overflow-hidden rounded-2xl border p-5 transition hover:-translate-y-1 hover:shadow-lg ${isUnit ? "border-amber-100 bg-gradient-to-br from-white to-amber-50/70 dark:border-amber-900 dark:from-slate-900 dark:to-amber-950/40" : "border-violet-100 bg-gradient-to-br from-white to-violet-50/70 dark:border-violet-900 dark:from-slate-900 dark:to-violet-950/40"}`}>
            <div className={`absolute right-0 top-0 h-20 w-20 translate-x-7 -translate-y-7 rounded-full ${isUnit ? "bg-amber-200/40" : "bg-violet-200/40"}`} />
            <div className="relative flex items-start justify-between"><div className={`flex h-11 w-11 items-center justify-center rounded-xl ${isUnit ? "bg-amber-100 text-amber-700" : "bg-violet-100 text-violet-700"}`}><ItemIcon size={20} /></div><span className="text-[10px] font-bold text-slate-400">#{String(startIndex + index + 1).padStart(2, "0")}</span></div>
            <p className="mt-5 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">{isUnit ? item.code ?? "UNIT" : "BRAND"}</p><h3 className="mt-1 truncate text-lg font-bold text-slate-900">{item.name}</h3>
            <div className="mt-4 flex items-center justify-between"><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${item.isActive ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{item.isActive ? "ACTIVE" : "INACTIVE"}</span><span className="text-[10px] text-slate-400">{formatDate(item.createdAt)}</span></div>
            <div className="mt-5 flex gap-2 border-t border-slate-200/70 pt-4"><button type="button" onClick={() => setViewing(item)} className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-white"><Eye size={13} className="mr-1 inline" /> View</button>{canWrite && <button type="button" onClick={() => openEdit(item)} className="rounded-lg bg-sky-500 px-3 py-2 text-white"><Pencil size={13} /></button>}{canDelete && <button type="button" disabled={!item.isActive} onClick={() => void handleDeactivate(item)} className="rounded-lg bg-red-500 px-3 py-2 text-white disabled:opacity-30"><Trash2 size={13} /></button>}</div>
          </article>)}
        </div>}

        {/* PAGINATION */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-5 text-xs text-slate-500 sm:px-7">
          <span>
            Showing {showingFrom} to {showingTo}
            {" "}of {filtered.length} entries
          </span>

          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() =>
                setPage(safePage - 1)
              }
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
              onClick={() =>
                setPage(safePage + 1)
              }
              className="disabled:opacity-35"
            >
              Next
            </button>
          </div>
        </div>
      </section>

      {/* ADD / EDIT MODAL */}
      {modalOpen && canWrite && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4"
          onMouseDown={event => {
            if (event.target === event.currentTarget) {
              closeModal();
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="master-dialog-title"
            className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl"
          >
            {/* HEADER */}
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
              <div>
                <h2
                  id="master-dialog-title"
                  className="text-lg font-bold text-slate-900"
                >
                  {editing ? "Edit" : "Add New"}{" "}
                  {isUnit ? "Unit" : "Brand"}
                </h2>

                <p className="mt-1 text-xs text-slate-400">
                  {editing
                    ? "Update master data information."
                    : "Create new master data."}
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
              {isUnit && (
                <div>
                  <label
                    htmlFor="master-code"
                    className={labelClass}
                  >
                    Unit Code *
                  </label>

                  <input
                    id="master-code"
                    value={code}
                    maxLength={20}
                    required
                    onChange={event =>
                      setCode(event.target.value)
                    }
                    placeholder="e.g. PCS"
                    className={inputClass}
                  />
                </div>
              )}

              <div>
                <label
                  htmlFor="master-name"
                  className={labelClass}
                >
                  {isUnit ? "Unit" : "Brand"} Name *
                </label>

                <input
                  id="master-name"
                  autoFocus
                  value={name}
                  maxLength={100}
                  required
                  onChange={event =>
                    setName(event.target.value)
                  }
                  placeholder={
                    isUnit
                      ? "e.g. Pieces"
                      : "e.g. Logitech"
                  }
                  className={inputClass}
                />
              </div>

              <div>
                <label
                  htmlFor="master-status"
                  className={labelClass}
                >
                  Status
                </label>

                <select
                  id="master-status"
                  value={isActive ? "active" : "inactive"}
                  onChange={event =>
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

              {formError && (
                <div
                  role="alert"
                  className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-xs text-red-700"
                >
                  <AlertCircle size={16} />
                  {formError}
                </div>
              )}

              {/* ACTIONS */}
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
                      ? "Update"
                      : "Save"}{" "}
                  {isUnit ? "Unit" : "Brand"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {viewing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setViewing(null); }}>
          <div role="dialog" aria-modal="true" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-widest text-blue-600">{isUnit ? "Unit" : "Brand"} detail</p><h2 className="mt-1 text-xl font-bold text-slate-900">{viewing.name}</h2></div><button type="button" onClick={() => setViewing(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X size={18} /></button></div>
            <div className="mt-6 grid gap-3 text-sm">{isUnit && <div className="flex items-center justify-between rounded-xl bg-slate-50 p-4"><span className="text-slate-500">Code</span><span className="font-mono font-semibold text-slate-800">{viewing.code ?? "—"}</span></div>}<div className="flex items-center justify-between rounded-xl bg-slate-50 p-4"><span className="text-slate-500">Status</span><span className="font-semibold text-slate-800">{viewing.isActive ? "Active" : "Inactive"}</span></div><div className="flex items-center justify-between rounded-xl bg-slate-50 p-4"><span className="text-slate-500">Created</span><span className="font-semibold text-slate-800">{formatDate(viewing.createdAt)}</span></div></div>
            <div className="mt-6 flex justify-end"><button type="button" onClick={() => setViewing(null)} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Close</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

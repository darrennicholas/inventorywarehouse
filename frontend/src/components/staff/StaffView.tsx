
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
  UserRound,
  X,
} from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";

import { useStaff } from "@/hooks/useStaff";
import { staffService } from "@/services/staff.service";

import type {
  Staff,
  StaffInput,
  StaffWarehouse,
} from "@/types/staff";

// ======================================
// STYLING
// ======================================

const inputClass =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

const labelClass =
  "mb-1.5 block text-xs font-semibold text-slate-700";

// ======================================
// HELPERS
// ======================================

function dateLabel(value: string) {
  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString("id-ID", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
}

function emptyForm(): StaffInput {
  return {
    staffCode: "",
    fullName: "",
    email: null,
    phone: null,
    position: null,
    warehouseId: null,
    isActive: true,
  };
}

type Notice = {
  type: "success" | "error";
  text: string;
} | null;

// ======================================
// STAFF VIEW COMPONENT
// ======================================

export default function StaffView() {
  const { can } = useAuth();
  const canWrite = can("staff.write");

  const {
    staff,
    loading,
    saving,
    error,
    refresh,
    create,
    update,
    deactivate,
  } = useStaff();

  // ====================================
  // WAREHOUSE OPTIONS
  // ====================================

  const [
    warehouseOptions,
    setWarehouseOptions,
  ] = useState<StaffWarehouse[]>([]);

  const [
    warehouseLoading,
    setWarehouseLoading,
  ] = useState(true);

  const [
    warehouseError,
    setWarehouseError,
  ] = useState("");

  // ====================================
  // TABLE STATE
  // ====================================

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] =
    useState("all");

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] =
    useState(10);

  // ====================================
  // ADD / EDIT MODAL
  // ====================================

  const [editing, setEditing] =
    useState<Staff | null>(null);

  const [modalOpen, setModalOpen] =
    useState(false);

  const [form, setForm] =
    useState<StaffInput>(emptyForm);

  const [formError, setFormError] =
    useState("");

  // ====================================
  // DETAIL MODAL
  // ====================================

  const [viewing, setViewing] =
    useState<Staff | null>(null);

  const [
    detailLoading,
    setDetailLoading,
  ] = useState(false);

  const [notice, setNotice] =
    useState<Notice>(null);

  // ====================================
  // GET WAREHOUSE DATA
  // ====================================

  useEffect(() => {
    const controller =
      new AbortController();

    void Promise.resolve().then(() =>
      setWarehouseLoading(true)
    );

    staffService
      .warehouseOptions(controller.signal)
      .then((rows) => {
        if (!controller.signal.aborted) {
          setWarehouseOptions(rows);
          setWarehouseError("");
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted) {
          setWarehouseError(
            reason instanceof Error
              ? reason.message
              : "Failed to load warehouses"
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setWarehouseLoading(false);
        }
      });

    return () => controller.abort();
  }, []);

  // ====================================
  // SEARCH & FILTER
  // ====================================

  const filtered = useMemo(() => {
    const keyword =
      search.trim().toLowerCase();

    return staff.filter((person) => {
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active"
          ? person.isActive
          : !person.isActive);

      const matchesText =
        !keyword ||
        [
          person.staffCode,
          person.fullName,
          person.email ?? "",
          person.phone ?? "",
          person.position ?? "",
          person.warehouse?.name ?? "",
          person.warehouse?.code ?? "",
        ].some((value) =>
          value.toLowerCase().includes(keyword)
        );

      return matchesStatus && matchesText;
    });
  }, [staff, search, statusFilter]);

  // ====================================
  // PAGINATION
  // ====================================

  const pageCount = Math.max(
    1,
    Math.ceil(filtered.length / pageSize)
  );

  const currentPage = Math.min(
    page,
    pageCount
  );

  const startIndex =
    (currentPage - 1) * pageSize;

  const rows = filtered.slice(
    startIndex,
    startIndex + pageSize
  );

  const from =
    filtered.length === 0
      ? 0
      : startIndex + 1;

  const to = Math.min(
    startIndex + pageSize,
    filtered.length
  );

  // ====================================
  // UPDATE FORM FIELD
  // ====================================

  function setField<
    K extends keyof StaffInput
  >(
    field: K,
    value: StaffInput[K]
  ) {
    setForm((previous) => ({
      ...previous,
      [field]: value,
    }));
  }

  // ====================================
  // OPEN ADD MODAL
  // ====================================

  function openAdd() {
    setEditing(null);
    setForm(emptyForm());
    setFormError("");
    setModalOpen(true);
  }

  // ====================================
  // OPEN EDIT MODAL
  // ====================================

  function openEdit(person: Staff) {
    setEditing(person);

    setForm({
      staffCode: person.staffCode,
      fullName: person.fullName,
      email: person.email,
      phone: person.phone,
      position: person.position,
      warehouseId: person.warehouseId,
      isActive: person.isActive,
    });

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
  // ESCAPE KEY
  // ====================================

  useEffect(() => {
    if (!modalOpen && !viewing) return;

    const onEscape = (
      event: KeyboardEvent
    ) => {
      if (
        event.key !== "Escape" ||
        saving
      ) {
        return;
      }

      setViewing(null);
      setModalOpen(false);
      setEditing(null);
    };

    window.addEventListener(
      "keydown",
      onEscape
    );

    return () => {
      window.removeEventListener(
        "keydown",
        onEscape
      );
    };
  }, [modalOpen, viewing, saving]);

  // ====================================
  // VIEW STAFF DETAIL
  // ====================================

  async function openDetail(id: string) {
    setNotice(null);
    setDetailLoading(true);

    try {
      const data =
        await staffService.detail(id);

      setViewing(data);
    } catch (reason) {
      setNotice({
        type: "error",
        text:
          reason instanceof Error
            ? reason.message
            : "Failed to load staff detail",
      });
    } finally {
      setDetailLoading(false);
    }
  }

  // ====================================
  // SAVE STAFF
  // ====================================

  async function save(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setFormError("");

    const payload: StaffInput = {
      staffCode: form.staffCode
        .trim()
        .toUpperCase(),

      fullName: form.fullName.trim(),

      email:
        form.email
          ?.trim()
          .toLowerCase() || null,

      phone:
        form.phone?.trim() || null,

      position:
        form.position?.trim() || null,

      warehouseId:
        form.warehouseId || null,

      isActive: form.isActive,
    };

    // VALIDATE STAFF CODE
    if (
      !/^[A-Z0-9][A-Z0-9_-]{1,39}$/.test(
        payload.staffCode
      )
    ) {
      setFormError(
        "Staff code must be 2–40 characters: letters, numbers, - or _."
      );
      return;
    }

    // VALIDATE FULL NAME
    if (payload.fullName.length < 2) {
      setFormError(
        "Full name must contain at least 2 characters."
      );
      return;
    }

    // VALIDATE WAREHOUSE
    if (payload.warehouseId) {
      const selected =
        warehouseOptions.find(
          (item) =>
            item.id === payload.warehouseId
        );

      if (
        !selected ||
        (
          !selected.isActive &&
          payload.warehouseId !==
            editing?.warehouseId
        )
      ) {
        setFormError(
          "Please select an active warehouse."
        );
        return;
      }
    }

    try {
      if (editing) {
        await update(editing.id, payload);
      } else {
        await create(payload);
      }

      setNotice({
        type: "success",
        text: `Staff ${
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
          : "Failed to save staff"
      );
    }
  }

  // ====================================
  // DEACTIVATE STAFF
  // ====================================

  async function handleDeactivate(
    person: Staff
  ) {
    if (
      !person.isActive ||
      saving
    ) {
      return;
    }

    const confirmed = window.confirm(
      `Deactivate ${person.fullName} (${person.staffCode})? The record will remain stored.`
    );

    if (!confirmed) return;

    try {
      await deactivate(person.id);

      setNotice({
        type: "success",
        text: `${person.fullName} deactivated successfully.`,
      });
    } catch (reason) {
      setNotice({
        type: "error",
        text:
          reason instanceof Error
            ? reason.message
            : "Failed to deactivate staff",
      });
    }
  }

  // ====================================
  // RENDER
  // ====================================

  return (
    <div className="space-y-4">
      {/* NOTIFICATION */}
      {notice && (
        <div
          role="status"
          className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-sm ${
            notice.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {notice.type === "success" ? (
            <CheckCircle2 size={17} />
          ) : (
            <AlertCircle size={17} />
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
          className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          <AlertCircle size={17} />

          <span className="flex-1">
            {error}
          </span>

          <button
            type="button"
            className="font-semibold underline"
            onClick={() => void refresh()}
          >
            Retry
          </button>
        </div>
      )}

      {/* STAFF TABLE */}
      <section className="overflow-hidden rounded-2xl border border-[#ebedf2] bg-white shadow-sm">
        {/* CARD HEADER */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 px-5 py-5 sm:px-7">
          <div>
            <h2 className="text-lg font-bold text-[#182237]">
              All Staff
            </h2>

            <p className="mt-1 text-xs text-slate-400">
              Manage employee profiles and warehouse assignments
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={loading}
              onClick={() => void refresh()}
              title="Refresh staff"
              aria-label="Refresh staff"
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw
                size={17}
                className={
                  loading
                    ? "animate-spin"
                    : ""
                }
              />
            </button>

            {canWrite && <button
              type="button"
              onClick={openAdd}
              className="inline-flex items-center gap-2 rounded-full bg-[#3867f6] px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-700"
            >
              <Plus size={17} />
              Add Staff
            </button>}
          </div>
        </div>

        {/* TOOLBAR */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-5 sm:px-7">
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
              className="rounded-md border border-slate-200 bg-white px-2 py-2"
            >
              {[10, 25, 50].map(
                (number) => (
                  <option
                    key={number}
                    value={number}
                  >
                    {number}
                  </option>
                )
              )}
            </select>

            entries
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* STATUS FILTER */}
            <select
              aria-label="Filter staff by status"
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(
                  event.target.value
                );
                setPage(1);
              }}
              className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs"
            >
              <option value="all">
                All Status
              </option>

              <option value="active">
                Active
              </option>

              <option value="inactive">
                Inactive
              </option>
            </select>

            {/* SEARCH */}
            <div className="relative">
              <Search
                size={15}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />

              <input
                aria-label="Search staff"
                type="search"
                value={search}
                onChange={(event) => {
                  setSearch(
                    event.target.value
                  );
                  setPage(1);
                }}
                placeholder="Search staff..."
                className="rounded-md border border-slate-200 py-2 pl-9 pr-3 text-xs outline-none focus:border-blue-500"
              />
            </div>
          </div>
        </div>

        {/* TABLE */}
        <div className="overflow-x-auto px-5 sm:px-7">
          <table className="w-full min-w-[950px] text-left text-xs">
            <thead>
              <tr className="border-b-2 border-slate-200 text-slate-700">
                {[
                  "No.",
                  "Staff Code",
                  "Full Name",
                  "Email / Phone",
                  "Position",
                  "Warehouse",
                  "Status",
                  "Action",
                ].map((label) => (
                  <th
                    key={label}
                    className="whitespace-nowrap px-3 py-3 font-bold"
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {!loading &&
                rows.map((person, index) => (
                  <tr
                    key={person.id}
                    className="hover:bg-[#f8faff]"
                  >
                    {/* NUMBER */}
                    <td className="px-3 py-4 text-slate-500">
                      {startIndex + index + 1}
                    </td>

                    {/* STAFF CODE */}
                    <td className="whitespace-nowrap px-3 py-4 font-mono font-semibold text-blue-600">
                      {person.staffCode}
                    </td>

                    {/* NAME */}
                    <td className="px-3 py-4">
                      <div className="flex items-center gap-2">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                          <UserRound size={17} />
                        </span>

                        <span className="font-semibold text-slate-800">
                          {person.fullName}
                        </span>
                      </div>
                    </td>

                    {/* EMAIL & PHONE */}
                    <td className="px-3 py-4 text-slate-600">
                      <div>
                        {person.email || "—"}
                      </div>

                      <div className="mt-1 text-slate-400">
                        {person.phone || "—"}
                      </div>
                    </td>

                    {/* POSITION */}
                    <td className="px-3 py-4 text-slate-600">
                      {person.position || "—"}
                    </td>

                    {/* WAREHOUSE */}
                    <td className="px-3 py-4 text-slate-600">
                      {person.warehouse
                        ? `${person.warehouse.code} — ${person.warehouse.name}`
                        : "Not assigned"}
                    </td>

                    {/* STATUS */}
                    <td className="px-3 py-4">
                      <span
                        className={`rounded-full px-3 py-1 font-semibold ${
                          person.isActive
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {person.isActive
                          ? "Active"
                          : "Inactive"}
                      </span>
                    </td>

                    {/* ACTIONS */}
                    <td className="whitespace-nowrap px-3 py-4">
                      <button
                        type="button"
                        disabled={detailLoading}
                        onClick={() =>
                          void openDetail(
                            person.id
                          )
                        }
                        title="View details"
                        className="mr-2 inline-flex items-center gap-1 rounded-md bg-slate-100 px-3 py-2 font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-50"
                      >
                        <Eye size={13} />
                        View
                      </button>

                      {canWrite && <button
                        type="button"
                        disabled={saving}
                        onClick={() =>
                          openEdit(person)
                        }
                        className="mr-2 inline-flex items-center gap-1 rounded-md bg-[#159fe2] px-3 py-2 font-semibold text-white disabled:opacity-50"
                      >
                        <Pencil size={13} />
                        Edit
                      </button>}

                      <button
                        type="button"
                        disabled={
                          saving ||
                          !person.isActive
                        }
                        onClick={() =>
                          void handleDeactivate(
                            person
                          )
                        }
                        title="Deactivate"
                        className="inline-flex items-center gap-1 rounded-md bg-red-500 px-2.5 py-2 font-semibold text-white disabled:opacity-35"
                      >
                        <Trash2 size={13} />
                      </button>
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
              Loading staff...
            </div>
          )}

          {/* EMPTY STATE */}
          {!loading &&
            filtered.length === 0 && (
              <div className="py-14 text-center text-sm text-slate-500">
                {search ||
                statusFilter !== "all"
                  ? "No matching staff"
                  : "No staff registered. Click Add Staff to begin."}
              </div>
            )}
        </div>

        {/* PAGINATION */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-5 text-xs text-slate-500 sm:px-7">
          <span>
            Showing {from} to {to} of{" "}
            {filtered.length} entries
          </span>

          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() =>
                setPage(
                  currentPage - 1
                )
              }
              className="disabled:opacity-35"
            >
              Previous
            </button>

            <span className="rounded-md bg-sky-500 px-3 py-2 font-bold text-white">
              {currentPage}
            </span>

            <span>/ {pageCount}</span>

            <button
              type="button"
              disabled={
                currentPage >= pageCount
              }
              onClick={() =>
                setPage(
                  currentPage + 1
                )
              }
              className="disabled:opacity-35"
            >
              Next
            </button>
          </div>
        </div>
      </section>

      {/* ================================= */}
      {/* ADD / EDIT STAFF MODAL */}
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
            aria-labelledby="staff-dialog-title"
            className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white shadow-2xl"
          >
            {/* MODAL HEADER */}
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
              <div>
                <h2
                  id="staff-dialog-title"
                  className="text-lg font-bold text-slate-900"
                >
                  {editing
                    ? "Edit Staff"
                    : "Add New Staff"}
                </h2>

                <p className="mt-1 text-xs text-slate-400">
                  {editing
                    ? "Update employee information"
                    : "Register a new employee"}
                </p>
              </div>

              <button
                type="button"
                aria-label="Close"
                disabled={saving}
                onClick={closeModal}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"
              >
                <X size={19} />
              </button>
            </div>

            {/* FORM */}
            <form
              onSubmit={save}
              className="space-y-4 p-6"
            >
              {/* STAFF CODE AND NAME */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="staff-code"
                    className={labelClass}
                  >
                    Staff Code *
                  </label>

                  <input
                    id="staff-code"
                    autoFocus
                    required
                    maxLength={40}
                    value={form.staffCode}
                    onChange={(event) =>
                      setField(
                        "staffCode",
                        event.target.value
                      )
                    }
                    placeholder="STF-001"
                    className={inputClass}
                  />
                </div>

                <div>
                  <label
                    htmlFor="staff-name"
                    className={labelClass}
                  >
                    Full Name *
                  </label>

                  <input
                    id="staff-name"
                    required
                    maxLength={120}
                    value={form.fullName}
                    onChange={(event) =>
                      setField(
                        "fullName",
                        event.target.value
                      )
                    }
                    placeholder="Andi Pratama"
                    className={inputClass}
                  />
                </div>
              </div>

              {/* EMAIL AND PHONE */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="staff-email"
                    className={labelClass}
                  >
                    Email
                  </label>

                  <input
                    id="staff-email"
                    type="email"
                    maxLength={254}
                    value={
                      form.email ?? ""
                    }
                    onChange={(event) =>
                      setField(
                        "email",
                        event.target.value ||
                          null
                      )
                    }
                    placeholder="andi@example.com"
                    className={inputClass}
                  />
                </div>

                <div>
                  <label
                    htmlFor="staff-phone"
                    className={labelClass}
                  >
                    Phone
                  </label>

                  <input
                    id="staff-phone"
                    type="tel"
                    maxLength={30}
                    value={
                      form.phone ?? ""
                    }
                    onChange={(event) =>
                      setField(
                        "phone",
                        event.target.value ||
                          null
                      )
                    }
                    placeholder="081234567890"
                    className={inputClass}
                  />
                </div>
              </div>

              {/* POSITION */}
              <div>
                <label
                  htmlFor="staff-position"
                  className={labelClass}
                >
                  Position
                </label>

                <input
                  id="staff-position"
                  maxLength={100}
                  value={
                    form.position ?? ""
                  }
                  onChange={(event) =>
                    setField(
                      "position",
                      event.target.value ||
                        null
                    )
                  }
                  placeholder="Warehouse Staff"
                  className={inputClass}
                />
              </div>

              {/* WAREHOUSE */}
              <div>
                <label
                  htmlFor="staff-warehouse"
                  className={labelClass}
                >
                  Assigned Warehouse
                </label>

                <select
                  id="staff-warehouse"
                  value={
                    form.warehouseId ?? ""
                  }
                  onChange={(event) =>
                    setField(
                      "warehouseId",
                      event.target.value ||
                        null
                    )
                  }
                  className={inputClass}
                >
                  <option value="">
                    No Warehouse / Unassigned
                  </option>

                  {warehouseOptions
                    .filter(
                      (warehouse) =>
                        warehouse.isActive ||
                        warehouse.id ===
                          editing?.warehouseId
                    )
                    .map(
                      (warehouse) => (
                        <option
                          key={
                            warehouse.id
                          }
                          value={
                            warehouse.id
                          }
                        >
                          {warehouse.code} —{" "}
                          {warehouse.name}
                          {warehouse.isActive
                            ? ""
                            : " (Inactive)"}
                        </option>
                      )
                    )}
                </select>

                {warehouseLoading && (
                  <p className="mt-1 text-xs text-slate-400">
                    Loading warehouses...
                  </p>
                )}

                {warehouseError && (
                  <p
                    role="alert"
                    className="mt-1 text-xs text-red-600"
                  >
                    {warehouseError}
                  </p>
                )}
              </div>

              {/* STATUS */}
              <div>
                <label
                  htmlFor="staff-status"
                  className={labelClass}
                >
                  Status
                </label>

                <select
                  id="staff-status"
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

              {/* FORM ERROR */}
              {formError && (
                <div
                  role="alert"
                  className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-xs text-red-700"
                >
                  <AlertCircle size={16} />
                  {formError}
                </div>
              )}

              {/* MODAL ACTIONS */}
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
                  disabled={
                    saving ||
                    warehouseLoading ||
                    !!warehouseError
                  }
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
                      ? "Update Staff"
                      : "Save Staff"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================================= */}
      {/* STAFF DETAIL MODAL */}
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
            aria-labelledby="staff-detail-title"
            className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl"
          >
            {/* HEADER */}
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
              <h2
                id="staff-detail-title"
                className="text-lg font-bold text-slate-900"
              >
                Staff Details
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

            {/* DETAIL FIELDS */}
            <div className="space-y-3 p-6 text-sm">
              {([
                [
                  "Staff Code",
                  viewing.staffCode,
                ],
                [
                  "Full Name",
                  viewing.fullName,
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
                  "Position",
                  viewing.position || "—",
                ],
                [
                  "Warehouse",
                  viewing.warehouse
                    ? `${viewing.warehouse.code} — ${viewing.warehouse.name}`
                    : "Not assigned",
                ],
                [
                  "Status",
                  viewing.isActive
                    ? "Active"
                    : "Inactive",
                ],
                [
                  "Created",
                  dateLabel(
                    viewing.createdAt
                  ),
                ],
                [
                  "Updated",
                  dateLabel(
                    viewing.updatedAt
                  ),
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

              {/* DETAIL ACTIONS */}
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
                    const current =
                      viewing;

                    setViewing(null);
                    openEdit(current);
                  }}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#3867f6] px-4 py-2 text-xs font-semibold text-white"
                >
                  <Pencil size={14} />
                  Edit Staff
                </button>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

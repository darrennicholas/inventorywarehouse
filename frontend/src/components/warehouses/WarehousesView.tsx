
"use client";

import GlobalLoading from "@/components/ui/GlobalLoading";
import GlobalSelect from "@/components/ui/GlobalSelect";
import { confirmAction } from "@/components/ui/GlobalAlert";
import ActionIconButton from "@/components/ui/ActionIconButton";
import { LoaderCircle } from "@/components/ui/GlobalLoading";
import {
  useEffect,
  useState,
  type FormEvent,
} from "react";

import { AlertCircle, Download, Eye, MapPin, Pencil, Plus, RefreshCw, Search, Trash2, Warehouse as WarehouseIcon, X } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import DataPagination from "@/components/ui/DataPagination";
import ActionFeedback from "@/components/ui/ActionFeedback";
import { statusLabel } from "@/lib/ui-labels";

import { usePagedMaster } from "@/hooks/usePagedMaster";
import { useWarehouses } from "@/hooks/useWarehouses";
import { warehouseService } from "@/services/warehouse.service";
import WarehouseLocationsPanel from "@/components/warehouses/WarehouseLocationsPanel";
import QuarantinePanel from "@/components/warehouses/QuarantinePanel";

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
    saving,
    createWarehouse,
    updateWarehouse,
    deactivateWarehouse,
  } = useWarehouses(false);

  // TABLE
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const { rows: warehouses, total, loading, error, reload: fetchWarehouses } = usePagedMaster<Warehouse>("/api/warehouses", page, pageSize, search, "all", saving, setPage);

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
      setNotice({ type: "success", message: `PDF lembar hitung stok untuk ${warehouse.name} berhasil diunduh.` });
    } catch (reason) {
      setNotice({ type: "error", message: reason instanceof Error ? reason.message : "Gagal mengunduh PDF" });
    } finally {
      setDownloadingId(null);
    }
  }

  // ====================================
  // SEARCH & FILTER
  // ====================================

  const filtered = warehouses;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const visible = warehouses;

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
            : "Gagal memuat rincian gudang",
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
        "Kode gudang harus terdiri dari 2–30 huruf, angka, tanda - atau _."
      );
      return;
    }

    if (cleanName.length < 2) {
      setFormError(
        "Nama gudang harus terdiri dari minimal 2 karakter."
      );
      return;
    }

    if (cleanAddress.length > 500) {
      setFormError(
        "Alamat tidak boleh lebih dari 500 karakter."
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
          message: `Gudang "${cleanName}" berhasil diperbarui.`,
        });
      } else {
        await createWarehouse(payload);

        setNotice({
          type: "success",
          message: `Gudang "${cleanName}" berhasil ditambahkan.`,
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
          : "Gagal menyimpan data gudang"
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

    const confirmed = await confirmAction(
      `Nonaktifkan gudang "${warehouse.name}" (${warehouse.code})? Data tidak akan dihapus permanen.`
    );

    if (!confirmed) return;

    setNotice(null);

    try {
      await deactivateWarehouse(warehouse.id);

      setNotice({
        type: "success",
        message: `Warehouse "${warehouse.name}" berhasil dinonaktifkan.`,
      });
    } catch (err) {
      setNotice({
        type: "error",
        message:
          err instanceof Error
            ? err.message
            : "Gagal menonaktifkan gudang",
      });
    }
  }

  // ====================================
  // RENDER
  // ====================================

  return (
    <div className="space-y-4">
      {/* NOTICE */}
      {notice && <ActionFeedback message={notice.message} tone={notice.type} onDismiss={() => setNotice(null)} />}

      {/* API ERROR */}
      {error && <ActionFeedback message={error} tone="error" action={{ label: "Coba lagi", onClick: () => void fetchWarehouses() }} />}

      <div className="grid gap-3 md:grid-cols-[1.3fr_1fr_1fr]">
        <div className="relative overflow-hidden rounded-2xl bg-slate-900 p-5 text-white shadow-sm"><div className="absolute -right-8 -top-10 h-28 w-28 rounded-full border-[18px] border-cyan-400/20" /><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-300">Jaringan gudang</p><p className="mt-2 text-2xl font-bold">{total} gudang</p><p className="mt-1 text-xs text-slate-400">Unduh PDF hitung stok dari baris gudang.</p></div>
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-5 dark:border-emerald-900 dark:bg-emerald-950/30"><p className="text-xs font-semibold text-emerald-700">Gudang aktif</p><p className="mt-2 text-2xl font-bold text-slate-900">{warehouses.filter((warehouse) => warehouse.isActive).length}</p></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-xs font-semibold text-slate-500">Gudang tidak aktif</p><p className="mt-2 text-2xl font-bold text-slate-900">{warehouses.filter((warehouse) => !warehouse.isActive).length}</p></div>
      </div>

      {/* MAIN CARD */}
      <section className="overflow-hidden rounded-2xl border border-[#ebedf2] bg-white shadow-sm">
        {/* HEADER */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 px-5 py-5 sm:px-7">
          <div>
            <h2 className="text-lg font-bold text-[#182237]">
              Semua gudang
            </h2>

            <p className="mt-1 text-xs text-slate-400">
              Kelola data gudang dan lokasi penyimpanan
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={loading}
              onClick={() => void fetchWarehouses()}
              title="Muat ulang gudang"
              aria-label="Muat ulang gudang"
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
              Tambah gudang
            </button>}
          </div>
        </div>

        {/* TOOLBAR */}
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-7">
          <div className="flex items-center gap-2">
            <label
              htmlFor="warehouse-search"
              className="text-xs text-slate-600"
            >
              Cari:
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
                placeholder="Kode, nama, atau alamat..."
                className="w-full rounded-md border border-slate-200 py-2 pl-9 pr-3 text-xs outline-none focus:border-blue-500"
              />
            </div>
          </div>
        </div>

        {/* KARTU UNTUK LAYAR KECIL */}
        <div className="divide-y divide-slate-100 px-5 md:hidden">
          {loading && <div className="py-8 text-center text-sm text-slate-500"><GlobalLoading label="Memuat gudang..." /></div>}
          {!loading && visible.map((warehouse, index) => <article key={warehouse.id} className="space-y-3 py-4">
            <div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><WarehouseIcon size={18} /></span><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><h3 className="truncate font-bold text-slate-900">{warehouse.name}</h3><span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${warehouse.isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{statusLabel(warehouse.isActive ? "ACTIVE" : "INACTIVE")}</span></div><p className="mt-1 font-mono text-xs text-blue-600">{warehouse.code}</p></div></div>
            <div className="rounded-xl bg-slate-50 p-3 text-xs"><p className="text-slate-400">Alamat</p><p className="mt-1 text-slate-700">{warehouse.address || "—"}</p><p className="mt-3 text-slate-400">Dibuat</p><p className="mt-1 text-slate-700">{formatDate(warehouse.createdAt)}</p></div>
            <div className="flex items-center justify-between text-xs text-slate-400"><span>#{startIndex + index + 1}</span></div>
            <div data-sf-action-column className="flex items-center gap-1 border-t border-slate-100 pt-3"><ActionIconButton label={`Lihat ${warehouse.name}`} icon={Eye} disabled={detailLoading} onClick={() => void openDetail(warehouse.id)} /><ActionIconButton label={`Unduh lembar opname ${warehouse.name}`} icon={Download} variant="violet" disabled={downloadingId === warehouse.id} onClick={() => void downloadSheet(warehouse)} />{canWrite && <ActionIconButton label={`Ubah ${warehouse.name}`} icon={Pencil} variant="warning" disabled={saving} onClick={() => openEdit(warehouse)} />}{canWrite && <ActionIconButton label={`Nonaktifkan ${warehouse.name}`} icon={Trash2} variant="danger" disabled={saving || !warehouse.isActive} onClick={() => void handleDeactivate(warehouse)} />}</div>
          </article>)}
          {!loading && visible.length === 0 && <p className="py-10 text-center text-sm text-slate-500">{search ? "Tidak ada gudang yang cocok." : "Belum ada gudang."}</p>}
        </div>

        {/* TABEL DESKTOP */}
        <div className="hidden overflow-x-auto px-5 sm:px-7 md:block">
          <table className="w-full min-w-[850px] text-left text-xs">
            <thead>
              <tr className="border-b-2 border-slate-200 text-slate-700">
                {[
                  "Aksi",
                  "No.",
                  "Kode",
                  "Nama gudang",
                  "Alamat",
                  "Status",
                  "Dibuat",
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
                    <td className="px-3 py-4 align-middle"><div data-sf-action-column className="flex items-center gap-1"><ActionIconButton label={`Lihat rincian ${warehouse.name}`} icon={Eye} disabled={detailLoading} onClick={() => void openDetail(warehouse.id)} /><ActionIconButton label={`Unduh lembar hitung stok fisik untuk ${warehouse.name}`} icon={Download} variant="violet" disabled={downloadingId === warehouse.id} onClick={() => void downloadSheet(warehouse)} />{canWrite && <ActionIconButton label={`Ubah ${warehouse.name}`} icon={Pencil} variant="warning" disabled={saving} onClick={() => openEdit(warehouse)} />}{canWrite && <ActionIconButton label={`Nonaktifkan ${warehouse.name}`} icon={Trash2} variant="danger" disabled={saving || !warehouse.isActive} onClick={() => void handleDeactivate(warehouse)} />}</div></td>
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
                          ? "Aktif"
                          : "Tidak aktif"}
                      </span>
                    </td>

                    {/* CREATED */}
                    <td className="whitespace-nowrap px-3 py-4 text-slate-500">
                      {formatDate(warehouse.createdAt)}
                    </td>

                  </tr>
                ))}
            </tbody>
          </table>

          {/* LOADING */}
          {loading && (
            <div className="flex items-center justify-center gap-2 py-14 text-sm text-slate-500">
              <GlobalLoading label="Memuat gudang..." />
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
                  ? "Tidak ada gudang yang cocok"
                  : "Belum ada gudang"}
              </p>

              <p className="mt-1 text-xs text-slate-400">
                {search
                  ? "Coba kata kunci pencarian lain."
                  : "Tambahkan gudang pertama untuk memulai."}
              </p>

              {!search && canWrite && (
                <button
                  type="button"
                  onClick={openAdd}
                  className="mt-5 rounded-lg bg-[#3867f6] px-4 py-2.5 text-xs font-semibold text-white"
                >
                  Tambah gudang pertama
                </button>
              )}
            </div>
          )}
        </div>

        <DataPagination page={safePage} pageSize={pageSize} total={total} totalPages={totalPages} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} loading={loading} noun="gudang" />
      </section>

      {/* ================================= */}
      {/* ADD / EDIT WAREHOUSE MODAL */}
      {/* ================================= */}

      {modalOpen && canWrite && (
        <div
          className="sf-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4"
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
                    ? "Ubah gudang"
                    : "Tambah gudang baru"}
                </h2>

                <p className="mt-1 text-xs text-slate-400">
                  {editing
                    ? "Perbarui informasi gudang."
                    : "Daftarkan gudang dan lokasi penyimpanannya."}
                </p>
              </div>

              <button
                type="button"
                disabled={saving}
                onClick={closeModal}
                aria-label="Tutup dialog"
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 disabled:opacity-50"
              >
                <X size={19} />
              </button>
            </div>

            {/* FORM */}
            <form
              onSubmit={handleSubmit}
              autoComplete="off"
              className="space-y-5 p-6"
            >
              {/* CODE */}
              <div>
                <label
                  htmlFor="warehouse-code"
                  className={labelClass}
                >
                  Kode gudang *
                </label>

                <input
                  id="warehouse-code"
                  type="text"
                  autoComplete="off"
                  value={code}
                  onChange={(event) =>
                    setCode(event.target.value)
                  }
                  maxLength={30}
                  required
                  autoFocus
                  placeholder="misalnya WH-JKT"
                  className={inputClass}
                />
              </div>

              {/* NAME */}
              <div>
                <label
                  htmlFor="warehouse-name"
                  className={labelClass}
                >
                  Nama gudang *
                </label>

                <input
                  id="warehouse-name"
                  type="text"
                  autoComplete="off"
                  value={name}
                  onChange={(event) =>
                    setName(event.target.value)
                  }
                  maxLength={120}
                  required
                  placeholder="misalnya Gudang Utama Jakarta"
                  className={inputClass}
                />
              </div>

              {/* ADDRESS */}
              <div>
                <label
                  htmlFor="warehouse-address"
                  className={labelClass}
                >
                  Alamat gudang
                </label>

                <textarea
                  id="warehouse-address"
                  autoComplete="off"
                  value={address}
                  onChange={(event) =>
                    setAddress(event.target.value)
                  }
                  maxLength={500}
                  rows={3}
                  placeholder="Masukkan alamat gudang..."
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

                <GlobalSelect
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
                    Aktif
                  </option>

                  <option value="inactive">
                    Tidak aktif
                  </option>
                </GlobalSelect>
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
                  Batal
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
                    ? "Menyimpan..."
                    : editing
                      ? "Perbarui gudang"
                      : "Simpan gudang"}
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
          className="sf-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4"
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
                  Rincian gudang
                </h2>

                <p className="mt-1 text-xs text-slate-400">
                  Informasi gudang hanya untuk dilihat
                </p>
              </div>

              <button
                type="button"
                onClick={() => setViewing(null)}
                aria-label="Tutup rincian"
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
              >
                <X size={19} />
              </button>
            </div>

            <div className="space-y-4 p-6 text-sm">
              {[
                ["Kode gudang", viewing.code],
                ["Nama gudang", viewing.name],
                ["Alamat", viewing.address || "—"],
                [
                  "Status",
                  statusLabel(viewing.isActive ? "ACTIVE" : "INACTIVE"),
                ],
                [
                  "Dibuat pada",
                  new Date(viewing.createdAt).toLocaleString("id-ID"),
                ],
                [
                  "Diperbarui pada",
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
              {can("inventory.read") && <QuarantinePanel key={viewing.id} warehouseId={viewing.id} />}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setViewing(null)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700"
                >
                  Tutup
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
                  Ubah gudang
                </button>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

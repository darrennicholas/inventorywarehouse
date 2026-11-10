
"use client";

import GlobalSelect from "@/components/ui/GlobalSelect";
import { confirmAction } from "@/components/ui/GlobalAlert";
import ActionIconButton from "@/components/ui/ActionIconButton";
import { LoaderCircle } from "@/components/ui/GlobalLoading";
import {
  useEffect,
  useState,
  type FormEvent,
} from "react";

import { AlertCircle, Eye, Pencil, Plus, RefreshCw, Tags, Trash2, X } from "lucide-react";
import DataPagination from "@/components/ui/DataPagination";
import DataTable from "@/components/ui/DataTable";
import ActionFeedback from "@/components/ui/ActionFeedback";
import StatusBadge from "@/components/ui/StatusBadge";

import { usePagedMaster } from "@/hooks/usePagedMaster";
import { useCategories } from "@/hooks/useCategories";
import { useAuth } from "@/components/auth/AuthProvider";
import type { Category } from "@/types/category";

type Notice = {
  type: "success" | "error";
  message: string;
} | null;

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

export default function CategoriesView() {
  const { can } = useAuth();
  const canWrite = can("categories.write");
  const canDelete = can("categories.delete");

  const {
    saving,
    createCategory,
    updateCategory,
    deactivateCategory,
  } = useCategories(false);

  // TABLE STATE
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const { rows: categories, total, loading, error, reload: fetchCategories } = usePagedMaster<Category>("/api/categories", currentPage, pageSize, search, "all", saving, setCurrentPage);

  // MODAL STATE
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] =
    useState<Category | null>(null);
  const [viewingCategory, setViewingCategory] =
    useState<Category | null>(null);

  // FORM STATE
  const [name, setName] = useState("");
  const [description, setDeskripsi] = useState("");
  const [isActive, setIsActive] = useState(true);

  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState<Notice>(null);

  // =========================================
  // FILTER CATEGORIES
  // =========================================

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const paginatedCategories = categories;

  // =========================================
  // MODAL FUNCTIONS
  // =========================================

  function openAddModal() {
    setEditingCategory(null);
    setName("");
    setDeskripsi("");
    setIsActive(true);
    setFormError("");
    setModalOpen(true);
  }

  function openEditModal(category: Category) {
    setEditingCategory(category);
    setName(category.name);
    setDeskripsi(category.description ?? "");
    setIsActive(category.isActive);
    setFormError("");
    setModalOpen(true);
  }

  function closeModal() {
    if (saving) return;

    setModalOpen(false);
    setEditingCategory(null);
    setFormError("");
  }

  useEffect(() => {
    if (!modalOpen) return;

    function onEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) {
        setModalOpen(false);
        setEditingCategory(null);
        setFormError("");
      }
    }

    window.addEventListener("keydown", onEscape);

    return () => {
      window.removeEventListener("keydown", onEscape);
    };
  }, [modalOpen, saving]);

  // =========================================
  // CREATE / UPDATE CATEGORY
  // =========================================

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    const cleanName = name.trim();
    const cleanDeskripsi = description.trim();

    if (cleanName.length < 2) {
      setFormError(
        "Nama kategori minimal harus terdiri dari 2 karakter."
      );
      return;
    }

    setFormError("");

    try {
      if (editingCategory) {
        await updateCategory(editingCategory.id, {
          name: cleanName,
          description: cleanDeskripsi || null,
          isActive,
        });

        setNotice({
          type: "success",
          message: "Kategori berhasil diperbarui.",
        });
      } else {
        await createCategory({
          name: cleanName,
          description: cleanDeskripsi || null,
          isActive,
        });

        setNotice({
          type: "success",
          message: "Kategori berhasil ditambahkan.",
        });
      }

      setModalOpen(false);
      setEditingCategory(null);
      setCurrentPage(1);
      setSearch("");
    } catch (err) {
      setFormError(
        err instanceof Error
          ? err.message
          : "Gagal menyimpan kategori"
      );
    }
  }

  async function handleDeactivate(category: Category) {
    if (!await confirmAction(`Nonaktifkan kategori "${category.name}"? Data tetap tersimpan.`)) return;
    try {
      await deactivateCategory(category.id);
      setNotice({ type: "success", message: "Kategori berhasil dinonaktifkan." });
    } catch (err) {
      setNotice({ type: "error", message: err instanceof Error ? err.message : "Gagal menonaktifkan kategori" });
    }
  }

  // =========================================
  // RENDER
  // =========================================

  return (
    <div className="space-y-5">
      {/* SUCCESS / ERROR NOTICE */}
      {notice && <ActionFeedback message={notice.message} tone={notice.type} onDismiss={() => setNotice(null)} />}

      {/* API ERROR */}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 to-white p-4 dark:border-blue-900 dark:from-blue-950/60 dark:to-slate-900"><p className="text-[10px] font-bold uppercase tracking-widest text-blue-500">Jumlah kategori</p><p className="mt-2 text-2xl font-bold text-slate-900">{total}</p><p className="mt-1 text-xs text-slate-500">Kategori sesuai pencarian</p></div>
        <div className="rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50 to-white p-4 dark:border-emerald-900 dark:from-emerald-950/50 dark:to-slate-900"><p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">Kategori aktif</p><p className="mt-2 text-2xl font-bold text-slate-900">{categories.filter((category) => category.isActive).length}</p><p className="mt-1 text-xs text-slate-500">Siap digunakan pada produk</p></div>
        <div className="rounded-2xl border border-violet-100 bg-gradient-to-br from-violet-50 to-white p-4 dark:border-violet-900 dark:from-violet-950/50 dark:to-slate-900"><p className="text-[10px] font-bold uppercase tracking-widest text-violet-600">Memiliki deskripsi</p><p className="mt-2 text-2xl font-bold text-slate-900">{categories.filter((category) => Boolean(category.description)).length}</p><p className="mt-1 text-xs text-slate-500">Kategori dengan keterangan</p></div>
      </div>

      {/* MAIN CARD */}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {/* HEADER */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 px-5 py-5 sm:px-7">
          <div>
            <h2 className="text-lg font-bold text-[#182237]">
              Semua kategori
            </h2>

            <p className="mt-1 text-xs text-slate-400">
              Kelola kategori produk
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void fetchCategories()}
              disabled={loading}
              aria-label="Refresh categories"
              title="Refresh"
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw
                size={17}
                className={loading ? "animate-spin" : ""}
              />
            </button>

            {canWrite && <button
              type="button"
              onClick={openAddModal}
              className="inline-flex items-center gap-2 rounded-full bg-[#3867f6] px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-blue-700"
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-[#3867f6]">
                <Plus size={14} strokeWidth={3} />
              </span>
              Tambah kategori
            </button>}
          </div>
        </div>

        <DataTable
          rows={paginatedCategories}
          loading={loading}
          error={error}
          onRetry={() => void fetchCategories()}
          search={search}
          onSearch={(value) => { setSearch(value); setCurrentPage(1); }}
          searchPlaceholder="Cari kategori..."
          empty={<div className="flex flex-col items-center gap-2"><Tags size={30} className="text-slate-300" /><p className="font-semibold">{search ? "Tidak ada kategori yang cocok" : "Kategori belum tersedia"}</p><p className="text-xs text-slate-500">{search ? "Coba kata kunci pencarian lain." : "Tambahkan kategori pertama untuk mulai mengelola produk."}</p>{!search && canWrite && <button type="button" onClick={openAddModal} className="mt-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700">Tambah kategori pertama</button>}</div>}
          columns={[
            { key: "actions", header: "Aksi", render: (category) => <div data-sf-action-column className="flex items-center gap-1"><ActionIconButton label={`Lihat kategori ${category.name}`} icon={Eye} onClick={() => setViewingCategory(category)} />{canWrite && <ActionIconButton label={`Ubah ${category.name}`} icon={Pencil} variant="warning" onClick={() => openEditModal(category)} />}{canDelete && <ActionIconButton label={`Nonaktifkan ${category.name}`} icon={Trash2} variant="danger" disabled={saving || !category.isActive} onClick={() => void handleDeactivate(category)} />}</div> },
            { key: "number", header: "No.", align: "right", render: (category) => startIndex + paginatedCategories.indexOf(category) + 1 },
            { key: "name", header: "Nama kategori", render: (category) => <span className="font-semibold text-slate-800">{category.name}</span> },
            { key: "description", header: "Deskripsi", className: "max-w-[18rem] truncate", render: (category) => <span title={category.description ?? undefined}>{category.description || "—"}</span> },
            { key: "status", header: "Status", render: (category) => <StatusBadge status={category.isActive ? "ACTIVE" : "INACTIVE"} /> },
            { key: "createdAt", header: "Dibuat", render: (category) => <span className="whitespace-nowrap">{formatDate(category.createdAt)}</span> },
          ]}
        />

        <DataPagination page={safePage} pageSize={pageSize} total={total} totalPages={totalPages} onPageChange={setCurrentPage} onPageSizeChange={(size) => { setPageSize(size); setCurrentPage(1); }} loading={loading} noun="kategori" />
      </section>

      {/* ================================== */}
      {/* ADD / EDIT CATEGORY MODAL */}
      {/* ================================== */}

      {modalOpen && canWrite && (
        <div
          className="sf-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeModal();
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="category-modal-title"
            className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl"
          >
            {/* MODAL HEADER */}
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
              <div>
                <h2
                  id="category-modal-title"
                  className="text-lg font-bold text-slate-800"
                >
                  {editingCategory
                  ? "Ubah kategori"
                    : "Tambah kategori"}
                </h2>

                <p className="mt-1 text-xs text-slate-400">
                  {editingCategory
                    ? "Perbarui informasi kategori."
                    : "Tambahkan kategori produk baru."}
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

            {/* CATEGORY FORM */}
            <form
              onSubmit={handleSubmit}
              className="space-y-5 p-6"
            >
              <div>
                <label
                  htmlFor="category-name"
                  className="mb-2 block text-sm font-semibold text-slate-700"
                >
                  Nama kategori
                  <span className="ml-1 text-red-500">
                    *
                  </span>
                </label>

                <input
                  id="category-name"
                  type="text"
                  autoFocus
                  value={name}
                  onChange={(event) =>
                    setName(event.target.value)
                  }
                  maxLength={100}
                  required
                  placeholder="Contoh: Elektronik"
                  className="w-full rounded-lg border border-slate-200 px-4 py-3 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </div>

              <div>
                <label
                  htmlFor="category-description"
                  className="mb-2 block text-sm font-semibold text-slate-700"
                >
                  Deskripsi
                </label>

                <textarea
                  id="category-description"
                  value={description}
                  onChange={(event) =>
                    setDeskripsi(event.target.value)
                  }
                  maxLength={500}
                  rows={3}
                  placeholder="Masukkan deskripsi kategori..."
                  className="w-full resize-none rounded-lg border border-slate-200 px-4 py-3 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </div>

              <div>
                <label
                  htmlFor="category-status"
                  className="mb-2 block text-sm font-semibold text-slate-700"
                >
                  Status
                </label>

                <GlobalSelect
                  id="category-status"
                  value={isActive ? "active" : "inactive"}
                  onChange={(event) =>
                    setIsActive(
                      event.target.value === "active"
                    )
                  }
                  className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none focus:border-blue-500"
                >
                  <option value="active">Aktif</option>
                  <option value="inactive">Tidak aktif</option>
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

              {/* MODAL FOOTER */}
              <div className="flex justify-end gap-3 border-t border-slate-100 pt-5">
                <button
                  type="button"
                  disabled={saving}
                  onClick={closeModal}
                  className="rounded-lg border border-slate-200 px-5 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
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
                  ) : editingCategory ? (
                    <Pencil size={16} />
                  ) : (
                    <Plus size={16} />
                  )}

                  {saving
                    ? "Menyimpan..."
                    : editingCategory
                      ? "Perbarui kategori"
                      : "Simpan kategori"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {viewingCategory && (
        <div className="sf-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setViewingCategory(null); }}>
          <div role="dialog" aria-modal="true" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div><p className="text-xs font-bold uppercase tracking-widest text-blue-600">Rincian kategori</p><h2 className="mt-1 text-xl font-bold text-slate-900">{viewingCategory.name}</h2></div>
              <button type="button" onClick={() => setViewingCategory(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
            </div>
            <div className="mt-6 grid gap-3 text-sm"><div className="rounded-xl bg-slate-50 p-4"><p className="text-xs text-slate-400">Deskripsi</p><p className="mt-1 font-medium text-slate-800">{viewingCategory.description || "Tidak ada deskripsi"}</p></div><div className="flex items-center justify-between rounded-xl bg-slate-50 p-4"><span className="text-slate-500">Status</span><span className="font-semibold text-slate-800">{viewingCategory.isActive ? "Aktif" : "Tidak aktif"}</span></div><div className="flex items-center justify-between rounded-xl bg-slate-50 p-4"><span className="text-slate-500">Dibuat</span><span className="font-semibold text-slate-800">{formatDate(viewingCategory.createdAt)}</span></div></div>
            <div className="mt-6 flex justify-end"><button type="button" onClick={() => setViewingCategory(null)} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Tutup</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

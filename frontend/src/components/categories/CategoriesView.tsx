
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
  Tags,
  Trash2,
  X,
} from "lucide-react";

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
    categories,
    loading,
    saving,
    error,
    fetchCategories,
    createCategory,
    updateCategory,
    deactivateCategory,
  } = useCategories();

  // TABLE STATE
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);

  // MODAL STATE
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] =
    useState<Category | null>(null);
  const [viewingCategory, setViewingCategory] =
    useState<Category | null>(null);

  // FORM STATE
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isActive, setIsActive] = useState(true);

  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState<Notice>(null);

  // =========================================
  // FILTER CATEGORIES
  // =========================================

  const filteredCategories = useMemo(() => {
    const keyword = search.trim().toLowerCase();

    if (!keyword) {
      return categories;
    }

    return categories.filter(
      (category) =>
        category.name.toLowerCase().includes(keyword) ||
        (category.description ?? "")
          .toLowerCase()
          .includes(keyword)
    );
  }, [categories, search]);

  const totalPages = Math.max(
    1,
    Math.ceil(filteredCategories.length / pageSize)
  );

  const safePage = Math.min(currentPage, totalPages);

  const startIndex = (safePage - 1) * pageSize;

  const paginatedCategories = filteredCategories.slice(
    startIndex,
    startIndex + pageSize
  );

  const showingFrom =
    filteredCategories.length > 0 ? startIndex + 1 : 0;

  const showingTo = Math.min(
    startIndex + pageSize,
    filteredCategories.length
  );

  // =========================================
  // MODAL FUNCTIONS
  // =========================================

  function openAddModal() {
    setEditingCategory(null);
    setName("");
    setDescription("");
    setIsActive(true);
    setFormError("");
    setModalOpen(true);
  }

  function openEditModal(category: Category) {
    setEditingCategory(category);
    setName(category.name);
    setDescription(category.description ?? "");
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
    const cleanDescription = description.trim();

    if (cleanName.length < 2) {
      setFormError(
        "Category name must contain at least 2 characters."
      );
      return;
    }

    setFormError("");

    try {
      if (editingCategory) {
        await updateCategory(editingCategory.id, {
          name: cleanName,
          description: cleanDescription || null,
          isActive,
        });

        setNotice({
          type: "success",
          message: "Category updated successfully.",
        });
      } else {
        await createCategory({
          name: cleanName,
          description: cleanDescription || null,
          isActive,
        });

        setNotice({
          type: "success",
          message: "Category created successfully.",
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
          : "Failed to save category"
      );
    }
  }

  async function handleDeactivate(category: Category) {
    if (!window.confirm(`Deactivate category "${category.name}"? The record will be retained.`)) return;
    try {
      await deactivateCategory(category.id);
      setNotice({ type: "success", message: "Category deactivated successfully." });
    } catch (err) {
      setNotice({ type: "error", message: err instanceof Error ? err.message : "Failed to deactivate category" });
    }
  }

  // =========================================
  // RENDER
  // =========================================

  return (
    <div className="space-y-5">
      {/* SUCCESS / ERROR NOTICE */}
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

          <span className="flex-1">{notice.message}</span>

          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Dismiss notification"
          >
            <X size={17} />
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
            onClick={() => void fetchCategories()}
            className="font-semibold underline"
          >
            Retry
          </button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 to-white p-4 dark:border-blue-900 dark:from-blue-950/60 dark:to-slate-900"><p className="text-[10px] font-bold uppercase tracking-widest text-blue-500">Taxonomy size</p><p className="mt-2 text-2xl font-bold text-slate-900">{categories.length}</p><p className="mt-1 text-xs text-slate-500">Product groups available</p></div>
        <div className="rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50 to-white p-4 dark:border-emerald-900 dark:from-emerald-950/50 dark:to-slate-900"><p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">Active groups</p><p className="mt-2 text-2xl font-bold text-slate-900">{categories.filter((category) => category.isActive).length}</p><p className="mt-1 text-xs text-slate-500">Ready for product assignment</p></div>
        <div className="rounded-2xl border border-violet-100 bg-gradient-to-br from-violet-50 to-white p-4 dark:border-violet-900 dark:from-violet-950/50 dark:to-slate-900"><p className="text-[10px] font-bold uppercase tracking-widest text-violet-600">Documented</p><p className="mt-2 text-2xl font-bold text-slate-900">{categories.filter((category) => Boolean(category.description)).length}</p><p className="mt-1 text-xs text-slate-500">Categories with descriptions</p></div>
      </div>

      {/* MAIN CARD */}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {/* HEADER */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 px-5 py-5 sm:px-7">
          <div>
            <h2 className="text-lg font-bold text-[#182237]">
              All Categories
            </h2>

            <p className="mt-1 text-xs text-slate-400">
              Manage product categories
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
              Add Categories
            </button>}
          </div>
        </div>

        {/* TABLE TOOLBAR */}
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-7">
          <div className="flex items-center gap-2 text-xs text-slate-600">
            Show
            <select
              aria-label="Entries per page"
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setCurrentPage(1);
              }}
              className="rounded-md border border-slate-200 px-2 py-2 text-xs"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
            </select>
            entries
          </div>

          <div className="flex w-full items-center gap-2 sm:w-auto">
            <label
              htmlFor="category-search"
              className="text-xs text-slate-600"
            >
              Search:
            </label>

            <div className="relative min-w-0 flex-1 sm:w-64">
              <Search
                size={15}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />

              <input
                id="category-search"
                type="search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setCurrentPage(1);
                }}
                placeholder="Search categories..."
                className="w-full rounded-md border border-slate-200 py-2 pl-9 pr-3 text-xs text-slate-800 outline-none focus:border-blue-400"
              />
            </div>
          </div>
        </div>

        {/* CATEGORY TABLE */}
        <div className="overflow-x-auto px-5 sm:px-7">
          <table className="w-full min-w-[650px] text-left text-xs">
            <thead>
              <tr className="border-b-2 border-slate-200 text-slate-700">
                <th className="px-3 py-3 font-bold">No.</th>
                <th className="px-3 py-3 font-bold">
                  Category Name
                </th>
                <th className="px-3 py-3 font-bold">
                  Description
                </th>
                <th className="px-3 py-3 font-bold">
                  Status
                </th>
                <th className="px-3 py-3 font-bold">
                  Created
                </th>
                <th className="px-3 py-3 font-bold">
                  Action
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {!loading &&
                paginatedCategories.map((category, index) => (
                  <tr
                    key={category.id}
                    className="hover:bg-[#f8faff]"
                  >
                    <td className="px-3 py-4 text-slate-500">
                      {startIndex + index + 1}
                    </td>

                    <td className="px-3 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                          <Tags size={17} />
                        </div>

                        <span className="font-semibold text-slate-800">
                          {category.name}
                        </span>
                      </div>
                    </td>

                    <td className="max-w-[260px] px-3 py-4 text-slate-500">
                      {category.description || "—"}
                    </td>

                    <td className="px-3 py-4">
                      <span
                        className={`inline-block rounded-full px-3 py-1 text-[11px] font-semibold ${
                          category.isActive
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {category.isActive
                          ? "Active"
                          : "Inactive"}
                      </span>
                    </td>

                    <td className="whitespace-nowrap px-3 py-4 text-slate-500">
                      {formatDate(category.createdAt)}
                    </td>

                    <td className="px-3 py-4">
                      <button
                        type="button"
                        onClick={() => setViewingCategory(category)}
                        className="mr-2 inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-2 font-semibold text-slate-600 hover:bg-slate-50"
                      >
                        <Eye size={13} />
                        View
                      </button>
                      {canWrite && <button
                        type="button"
                        onClick={() =>
                          openEditModal(category)
                        }
                        className="inline-flex items-center gap-1.5 rounded-md bg-[#159fe2] px-3 py-2 font-semibold text-white transition hover:bg-sky-600"
                      >
                        <Pencil size={13} />
                        Edit
                      </button>}
                      {canDelete && <button
                        type="button"
                        disabled={saving || !category.isActive}
                        onClick={() => void handleDeactivate(category)}
                        title="Deactivate"
                        className="ml-2 inline-flex items-center gap-1.5 rounded-md bg-red-500 px-3 py-2 font-semibold text-white disabled:opacity-35"
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
                size={19}
                className="animate-spin"
              />
              Loading categories...
            </div>
          )}

          {!loading && filteredCategories.length === 0 && (
            <div className="flex flex-col items-center py-14 text-center">
              <Tags size={35} className="text-slate-300" />
              <h3 className="mt-3 text-sm font-semibold text-slate-700">
                {search
                  ? "No matching categories"
                  : "No categories found"}
              </h3>

              <p className="mt-1 text-xs text-slate-400">
                {search
                  ? "Try another search keyword."
                  : "Add your first category."}
              </p>

              {!search && canWrite && (
                <button
                  type="button"
                  onClick={openAddModal}
                  className="mt-5 rounded-lg bg-[#3867f6] px-4 py-2.5 text-xs font-semibold text-white"
                >
                  Add First Category
                </button>
              )}
            </div>
          )}
        </div>

        {/* PAGINATION */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-5 sm:px-7">
          <p className="text-xs text-slate-500">
            Showing {showingFrom} to {showingTo} of{" "}
            {filteredCategories.length} entries
          </p>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() =>
                setCurrentPage((prev) =>
                  Math.max(1, prev - 1)
                )
              }
              className="rounded-md px-3 py-2 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-40"
            >
              Previous
            </button>

            <span className="flex h-8 min-w-8 items-center justify-center rounded-md bg-[#159fe2] px-2 text-xs font-bold text-white">
              {safePage}
            </span>

            <span className="text-xs text-slate-400">
              / {totalPages}
            </span>

            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() =>
                setCurrentPage((prev) =>
                  Math.min(totalPages, prev + 1)
                )
              }
              className="rounded-md px-3 py-2 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </section>

      {/* ================================== */}
      {/* ADD / EDIT CATEGORY MODAL */}
      {/* ================================== */}

      {modalOpen && canWrite && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
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
                    ? "Edit Category"
                    : "Add New Category"}
                </h2>

                <p className="mt-1 text-xs text-slate-400">
                  {editingCategory
                    ? "Update category information."
                    : "Create a new product category."}
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
                  Category Name
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
                  placeholder="e.g. Electronics"
                  className="w-full rounded-lg border border-slate-200 px-4 py-3 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </div>

              <div>
                <label
                  htmlFor="category-description"
                  className="mb-2 block text-sm font-semibold text-slate-700"
                >
                  Description
                </label>

                <textarea
                  id="category-description"
                  value={description}
                  onChange={(event) =>
                    setDescription(event.target.value)
                  }
                  maxLength={500}
                  rows={3}
                  placeholder="Enter category description..."
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

                <select
                  id="category-status"
                  value={isActive ? "active" : "inactive"}
                  onChange={(event) =>
                    setIsActive(
                      event.target.value === "active"
                    )
                  }
                  className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none focus:border-blue-500"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
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

              {/* MODAL FOOTER */}
              <div className="flex justify-end gap-3 border-t border-slate-100 pt-5">
                <button
                  type="button"
                  disabled={saving}
                  onClick={closeModal}
                  className="rounded-lg border border-slate-200 px-5 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
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
                  ) : editingCategory ? (
                    <Pencil size={16} />
                  ) : (
                    <Plus size={16} />
                  )}

                  {saving
                    ? "Saving..."
                    : editingCategory
                      ? "Update Category"
                      : "Save Category"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {viewingCategory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setViewingCategory(null); }}>
          <div role="dialog" aria-modal="true" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div><p className="text-xs font-bold uppercase tracking-widest text-blue-600">Category detail</p><h2 className="mt-1 text-xl font-bold text-slate-900">{viewingCategory.name}</h2></div>
              <button type="button" onClick={() => setViewingCategory(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
            </div>
            <div className="mt-6 grid gap-3 text-sm"><div className="rounded-xl bg-slate-50 p-4"><p className="text-xs text-slate-400">Description</p><p className="mt-1 font-medium text-slate-800">{viewingCategory.description || "No description"}</p></div><div className="flex items-center justify-between rounded-xl bg-slate-50 p-4"><span className="text-slate-500">Status</span><span className="font-semibold text-slate-800">{viewingCategory.isActive ? "Active" : "Inactive"}</span></div><div className="flex items-center justify-between rounded-xl bg-slate-50 p-4"><span className="text-slate-500">Created</span><span className="font-semibold text-slate-800">{formatDate(viewingCategory.createdAt)}</span></div></div>
            <div className="mt-6 flex justify-end"><button type="button" onClick={() => setViewingCategory(null)} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Close</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

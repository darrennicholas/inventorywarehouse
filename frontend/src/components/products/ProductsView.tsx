
"use client";

import GlobalLoading from "@/components/ui/GlobalLoading";
import GlobalSelect from "@/components/ui/GlobalSelect";
import { confirmAction } from "@/components/ui/GlobalAlert";
import { Eye, Pencil, Trash2 } from "@/components/ui/ActionIcons";

import {
  useCallback,
  useEffect,
  useState,
} from "react";

import { AlertCircle, Barcode, Package, Plus, RefreshCw, Search } from "lucide-react";

import { productService } from "@/services/product.service";
import { apiRequest } from "@/lib/api";
import { hasActionIntent } from "@/lib/action-intent";

import type {
  Product,
  ProductInput,
  ProductOptions,
} from "@/types/product";

import type {
  ProductStore,
} from "@/hooks/useProducts";

import ProductFormModal from "./ProductFormModal";
import { useAuth } from "@/components/auth/AuthProvider";

type Props = {
  store: ProductStore;
  createRequested: number;
};

const EMPTY_OPTIONS: ProductOptions = {
  categories: [],
  brands: [],
  units: [],
};

export default function ProductsView({
  store,
  createRequested,
}: Props) {
  const { can } = useAuth();
  const canWrite = can("products.write");
  const canDelete = can("products.delete");

  const {
    saving,
    createProduct,
    updateProduct,
    deactivateProduct,
  } = store;

  // Master dropdown options
  const [options, setOptions] =
    useState<ProductOptions>(EMPTY_OPTIONS);

  const [optionsError, setOptionsError] =
    useState("");

  const [optionsLoading, setOptionsLoading] =
    useState(false);

  // Table
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchProducts = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), search: search.trim() });
      const response = await apiRequest<{ data: Product[]; meta: { total: number } }>(`/api/products?${params}`, { signal });
      if (!signal?.aborted) { setProducts(response.data); setTotal(response.meta.total); const last = Math.max(1, Math.ceil(response.meta.total / pageSize)); if (page > last) setPage(last); }
    } catch (failure) { if (!signal?.aborted) setError(failure instanceof Error ? failure.message : "Produk tidak dapat dimuat."); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [page, pageSize, search]);
  useEffect(() => { const controller = new AbortController(); const timer = window.setTimeout(() => void fetchProducts(controller.signal), hasActionIntent() ? 0 : 250); return () => { window.clearTimeout(timer); controller.abort(); }; }, [fetchProducts, revision]);

  // Modal
  const [modalOpen, setModalOpen] = useState(false);

  const [editing, setEditing] =
    useState<Product | null>(null);
  const [viewing, setViewing] = useState<Product | null>(null);

  // Notifications
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");

  // =====================================
  // LOAD CATEGORY, BRAND AND UNIT
  // =====================================
  const loadOptions = useCallback(async () => {
    setOptionsLoading(true);
    setOptionsError("");

    try {
      const data = await productService.getOptions();
      setOptions(data);
    } catch (error) {
      setOptionsError(
        error instanceof Error
          ? error.message
          : "Failed to load master data"
      );
    } finally {
      setOptionsLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => loadOptions());
  }, [loadOptions]);

  // Open modal requested from Dashboard
  useEffect(() => {
    if (createRequested > 0) {
      void Promise.resolve().then(() => {
        setEditing(null);
        setModalOpen(true);
      });
    }
  }, [createRequested]);

  // =====================================
  // SEARCH
  // =====================================
  const filtered = products;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const offset = (safePage - 1) * pageSize;
  const visible = products;

  // =====================================
  // CREATE / UPDATE
  // =====================================
  async function save(data: ProductInput) {
    if (editing) {
      await updateProduct(editing.id, data);
    } else {
      await createProduct(data);
    }

    setModalOpen(false);
    setEditing(null);

    setNotice(
      "Product berhasil disimpan ke PostgreSQL."
    );

    setActionError("");
    setPage(1);
    setSearch("");
    setRevision((value) => value + 1);
  }

  // =====================================
  // DEACTIVATE PRODUCT
  // =====================================
  async function deactivate(product: Product) {
    const confirmed = await confirmAction(
      `Nonaktifkan produk ${product.name}? Data dan histori tidak akan dihapus.`
    );

    if (!confirmed) return;

    setActionError("");

    try {
      await deactivateProduct(product.id);
      setRevision((value) => value + 1);

      setNotice(
        `Product ${product.name} dinonaktifkan.`
      );
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "Failed to deactivate product"
      );
    }
  }

  // =====================================
  // MODAL CONTROLS
  // =====================================
  function openCreate() {
    setEditing(null);
    setModalOpen(true);
    void loadOptions();
  }

  function openEdit(product: Product) {
    setEditing(product);
    setModalOpen(true);
    void loadOptions();
  }

  return (
    <div className="space-y-4">
      {/* SUCCESS */}
      {notice && (
        <div
          role="status"
          className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          {notice}
        </div>
      )}

      {/* ERRORS */}
      {(actionError || error || optionsError) && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          <AlertCircle size={18} />

          {actionError || error || optionsError}
        </div>
      )}

      {/* MAIN PRODUCT CARD */}
      <section className="overflow-hidden rounded-2xl border border-[#ebedf2] bg-white shadow-sm">
        {/* HEADER */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 px-5 py-5 sm:px-7">
          <div>
            <h2 className="text-lg font-bold text-[#182237]">
              All Products
            </h2>

            <p className="mt-1 text-xs text-slate-400">
              Manage all registered products
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void fetchProducts()}
              disabled={loading}
              title="Refresh products"
              aria-label="Refresh products"
              className="rounded-lg border border-slate-200 p-2.5 text-slate-600 disabled:opacity-50"
            >
              <RefreshCw
                size={18}
                className={
                  loading ? "animate-spin" : ""
                }
              />
            </button>

            {canWrite && <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-2 rounded-full bg-[#3867f6] px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-700"
            >
              <Plus size={17} />
              Add Products
            </button>}
          </div>
        </div>

        {/* SEARCH AND PAGE SIZE */}
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-7">
          <div className="flex items-center gap-2 text-xs text-slate-600">
            Show

            <GlobalSelect
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
            </GlobalSelect>

            entries
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-600">
            <label htmlFor="products-search">
              Search:
            </label>

            <div className="relative">
              <Search
                size={15}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />

              <input
                id="products-search"
                type="search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="Name, SKU, Category..."
                className="rounded-md border border-slate-200 py-2 pl-9 pr-3 outline-none focus:border-blue-500"
              />
            </div>
          </div>
        </div>

        {/* TABLE */}
        <div className="overflow-x-auto px-5 sm:px-7">
          <table className="w-full min-w-[1170px] text-left text-xs">
            <thead>
              <tr className="border-b-2 border-slate-200 text-slate-700">
                {[
                  "Image",
                  "Name",
                  "SKU",
                  "Code",
                  "Category",
                  "Brand",
                  "Stock",
                  "Alert Qty",
                  "Unit",
                  "Barcode",
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
                visible.map((product) => (
                  <tr
                    key={product.id}
                    className="hover:bg-[#f8faff]"
                  >
                    {/* IMAGE */}
                    <td className="px-3 py-3">
                      <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-lg bg-blue-50 text-blue-600">
                        {product.imageUrl ? (
                          // External images from product data
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={product.imageUrl}
                            alt={product.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <Package size={21} />
                        )}
                      </div>
                    </td>

                    {/* NAME */}
                    <td className="max-w-[180px] px-3 py-3 font-semibold text-slate-800">
                      {product.name}
                    </td>

                    {/* SKU */}
                    <td className="whitespace-nowrap px-3 py-3 text-slate-600">
                      {product.sku}
                    </td>

                    {/* CODE */}
                    <td className="px-3 py-3 text-slate-600">
                      {product.code ?? "—"}
                    </td>

                    {/* CATEGORY */}
                    <td className="px-3 py-3 text-slate-600">
                      {product.category?.name ?? "—"}
                    </td>

                    {/* BRAND */}
                    <td className="px-3 py-3 text-slate-600">
                      {product.brand?.name ?? "—"}
                    </td>

                    {/* STOCK */}
                    <td
                      className="px-3 py-3 text-slate-600"
                      title={
                        product.totalStock === null
                          ? "Belum ada saldo stok tercatat"
                          : "Total semua gudang"
                      }
                    >
                      {product.totalStock ?? "—"}
                    </td>

                    {/* ALERT QTY */}
                    <td className="px-3 py-3 text-slate-600">
                      {product.minStock}
                    </td>

                    {/* UNIT */}
                    <td className="px-3 py-3 text-slate-600">
                      {product.unit?.code ?? "—"}
                    </td>

                    {/* BARCODE */}
                    <td className="px-3 py-3 text-slate-600">
                      {product.barcode ? (
                        <span className="inline-flex items-center gap-1">
                          <Barcode size={16} />
                          {product.barcode}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>

                    {/* STATUS */}
                    <td className="px-3 py-3">
                      <span
                        className={`rounded-full px-2.5 py-1 font-semibold ${
                          product.isActive
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {product.isActive
                          ? "Active"
                          : "Inactive"}
                      </span>
                    </td>

                    {/* ACTIONS */}
                    <td className="whitespace-nowrap px-3 py-3">
                      <button type="button" onClick={() => setViewing(product)} className="mr-2 inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-2 font-semibold text-slate-600 hover:bg-slate-50"><Eye size={13} /> View</button>
                      {canWrite && <button
                        type="button"
                        onClick={() => openEdit(product)}
                        disabled={saving}
                        className="mr-2 inline-flex items-center gap-1 rounded-md bg-[#159fe2] px-3 py-2 font-semibold text-white disabled:opacity-50"
                      >
                        <Pencil size={13} />
                        Edit
                      </button>}

                      {canDelete && <button
                        type="button"
                        onClick={() =>
                          void deactivate(product)
                        }
                        disabled={
                          saving || !product.isActive
                        }
                        title="Nonaktifkan produk"
                        aria-label={`Deactivate ${product.name}`}
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
              <GlobalLoading label="Loading products..." />
            </div>
          )}

          {/* EMPTY */}
          {!loading && filtered.length === 0 && (
            <div className="py-14 text-center text-sm text-slate-500">
              {search
                ? "No matching products"
                : "No products found"}
            </div>
          )}
        </div>

        {/* PAGINATION */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-5 text-xs text-slate-500 sm:px-7">
          <span>
            Showing{" "}
            {total ? offset + 1 : 0} to{" "}
            {Math.min(
              offset + pageSize,
              total
            )}{" "}
            of {total} entries
          </span>

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

        {/* FOOTER */}
        <p className="border-t border-slate-100 bg-[#fafbfe] px-5 py-3 text-[11px] text-slate-400 sm:px-7">
          Stock is read-only and calculated from
          {/* eslint-disable-next-line react/no-unescaped-entities */}
          InventoryBalance. "—" means no balance
          has been recorded for this product.
        </p>
      </section>

      {/* ADD / EDIT MODAL */}
      {modalOpen && canWrite &&
        (optionsLoading &&
        options.categories.length === 0 &&
        options.brands.length === 0 &&
        options.units.length === 0 ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60">
            <div className="rounded-lg bg-white p-6 text-sm text-slate-700">
              <GlobalLoading label="Loading form options..." />
            </div>
          </div>
        ) : (
          <ProductFormModal
            key={editing?.id ?? "new"}
            product={editing}
            options={options}
            saving={saving}
            onClose={() => setModalOpen(false)}
            onSubmit={save}
          />
        ))}

      {viewing && (
        <div className="sf-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setViewing(null); }}>
          <div role="dialog" aria-modal="true" className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between"><div><p className="text-xs font-bold uppercase tracking-widest text-blue-600">Product detail</p><h2 className="mt-1 text-xl font-bold text-slate-900">{viewing.name}</h2><p className="mt-1 text-sm text-slate-500">{viewing.sku}</p></div><button type="button" onClick={() => setViewing(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100">×</button></div>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">{[["Code", viewing.code || "—"], ["Category", viewing.category?.name || "—"], ["Brand", viewing.brand?.name || "—"], ["Unit", viewing.unit?.code || "—"], ["Stock", viewing.totalStock ?? "—"], ["Alert quantity", viewing.minStock]].map(([label, value]) => <div key={label} className="rounded-xl bg-slate-50 p-4"><p className="text-xs text-slate-400">{label}</p><p className="mt-1 font-semibold text-slate-800">{value}</p></div>)}</div>
            <div className="mt-6 flex justify-end"><button type="button" onClick={() => setViewing(null)} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Close</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

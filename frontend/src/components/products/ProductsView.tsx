
"use client";

import GlobalLoading from "@/components/ui/GlobalLoading";
import { confirmAction } from "@/components/ui/GlobalAlert";
import { Eye, Pencil, Trash2 } from "@/components/ui/ActionIcons";

import {
  useCallback,
  useEffect,
  useState,
} from "react";

import { Barcode, Package, Plus, RefreshCw, Search } from "lucide-react";

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
import DataPagination from "@/components/ui/DataPagination";
import ActionFeedback from "@/components/ui/ActionFeedback";
import { statusLabel } from "@/lib/ui-labels";

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
          : "Gagal memuat data master"
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
      "Produk berhasil disimpan."
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
          : "Gagal menonaktifkan produk"
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
      {notice && <ActionFeedback message={notice} tone="success" onDismiss={() => setNotice("")} />}

      {/* ERRORS */}
      {(actionError || error || optionsError) && <ActionFeedback message={actionError || error || optionsError || "Terjadi kesalahan."} tone="error" action={(error || optionsError) ? { label: "Coba lagi", onClick: () => void fetchProducts() } : undefined} onDismiss={() => setActionError("")} />}

      {/* MAIN PRODUCT CARD */}
      <section className="overflow-hidden rounded-2xl border border-[#ebedf2] bg-white shadow-sm">
        {/* HEADER */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 px-5 py-5 sm:px-7">
          <div>
            <h2 className="text-lg font-bold text-[#182237]">
              Semua produk
            </h2>

            <p className="mt-1 text-xs text-slate-400">
              Kelola semua data produk terdaftar
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void fetchProducts()}
              disabled={loading}
              title="Muat ulang produk"
              aria-label="Muat ulang produk"
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
              Tambah produk
            </button>}
          </div>
        </div>

        {/* SEARCH */}
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-7">
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <label htmlFor="products-search">
                Cari:
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
                placeholder="Nama, SKU, kategori..."
                className="rounded-md border border-slate-200 py-2 pl-9 pr-3 outline-none focus:border-blue-500"
              />
            </div>
          </div>
        </div>

        {/* KARTU UNTUK LAYAR KECIL */}
        <div className="divide-y divide-slate-100 px-5 md:hidden">
          {loading && <div className="py-8 text-center text-sm text-slate-500"><GlobalLoading label="Memuat produk..." /></div>}
          {!loading && visible.map((product) => <article key={product.id} className="space-y-3 py-4">
            <div className="flex items-start gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-blue-50 text-blue-600">
                <Package size={21} />
              </div>
              <div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><h3 className="truncate font-bold text-slate-900">{product.name}</h3><span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${product.isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{statusLabel(product.isActive ? "ACTIVE" : "INACTIVE")}</span></div><p className="mt-1 text-xs text-slate-500">SKU {product.sku}{product.code ? ` · ${product.code}` : ""}</p></div>
            </div>
            <dl className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3 text-xs">
              <div><dt className="text-slate-400">Kategori / merek</dt><dd className="mt-1 truncate font-medium text-slate-700">{product.category?.name ?? "—"} · {product.brand?.name ?? "—"}</dd></div>
              <div><dt className="text-slate-400">Stok / batas minimum</dt><dd className="mt-1 font-semibold text-slate-800">{product.totalStock ?? "—"} / {product.minStock} {product.unit?.code ?? "unit"}</dd></div>
              <div className="col-span-2"><dt className="text-slate-400">Kode batang</dt><dd className="mt-1 break-all text-slate-700">{product.barcode || "—"}</dd></div>
            </dl>
            <div data-sf-action-column className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
              <button type="button" onClick={() => setViewing(product)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700">Lihat</button>
              {canWrite && <button type="button" disabled={saving} onClick={() => openEdit(product)} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Ubah</button>}
              {canDelete && <button type="button" disabled={saving || !product.isActive} onClick={() => void deactivate(product)} className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">Nonaktifkan</button>}
            </div>
          </article>)}
          {!loading && visible.length === 0 && <p className="py-10 text-center text-sm text-slate-500">{search ? "Tidak ada produk yang cocok." : "Produk belum tersedia."}</p>}
        </div>

        {/* TABEL DESKTOP */}
        <div className="hidden overflow-x-auto px-5 sm:px-7 md:block">
          <table className="w-full min-w-[1170px] text-left text-xs">
            <thead>
              <tr className="border-b-2 border-slate-200 text-slate-700">
                {[
                  "Gambar",
                  "Nama",
                  "SKU",
                  "Kode",
                  "Kategori",
                  "Merek",
                  "Stok",
                  "Batas minimum",
                  "Satuan",
                  "Kode batang",
                  "Status",
                  "Aksi",
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
                        {statusLabel(product.isActive ? "ACTIVE" : "INACTIVE")}
                      </span>
                    </td>

                    {/* ACTIONS */}
                    <td className="whitespace-nowrap px-3 py-3">
                      <button type="button" onClick={() => setViewing(product)} className="mr-2 inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-2 font-semibold text-slate-600 hover:bg-slate-50"><Eye size={13} /> Lihat</button>
                      {canWrite && <button
                        type="button"
                        onClick={() => openEdit(product)}
                        disabled={saving}
                        className="mr-2 inline-flex items-center gap-1 rounded-md bg-[#159fe2] px-3 py-2 font-semibold text-white disabled:opacity-50"
                      >
                        <Pencil size={13} />
                        Ubah
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
              <GlobalLoading label="Memuat produk..." />
            </div>
          )}

          {/* EMPTY */}
          {!loading && filtered.length === 0 && (
            <div className="py-14 text-center text-sm text-slate-500">
              {search
                ? "Tidak ada produk yang cocok"
                : "Produk belum tersedia"}
            </div>
          )}
        </div>

        <DataPagination page={safePage} pageSize={pageSize} total={total} totalPages={totalPages} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} loading={loading} noun="produk" />

        {/* FOOTER */}
        <p className="border-t border-slate-100 bg-[#fafbfe] px-5 py-3 text-[11px] text-slate-400 sm:px-7">
          Stok bersifat hanya-baca dan dihitung dari
          {/* eslint-disable-next-line react/no-unescaped-entities */}
          InventoryBalance. "—" berarti belum ada saldo
          yang tercatat untuk produk ini.
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
              <GlobalLoading label="Memuat pilihan formulir..." />
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
            <div className="flex items-start justify-between"><div><p className="text-xs font-bold uppercase tracking-widest text-blue-600">Rincian produk</p><h2 className="mt-1 text-xl font-bold text-slate-900">{viewing.name}</h2><p className="mt-1 text-sm text-slate-500">{viewing.sku}</p></div><button type="button" onClick={() => setViewing(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100">×</button></div>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">{[["Kode", viewing.code || "—"], ["Kategori", viewing.category?.name || "—"], ["Merek", viewing.brand?.name || "—"], ["Satuan", viewing.unit?.code || "—"], ["Stok", viewing.totalStock ?? "—"], ["Batas minimum", viewing.minStock]].map(([label, value]) => <div key={label} className="rounded-xl bg-slate-50 p-4"><p className="text-xs text-slate-400">{label}</p><p className="mt-1 font-semibold text-slate-800">{value}</p></div>)}</div>
            <div className="mt-6 flex justify-end"><button type="button" onClick={() => setViewing(null)} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Tutup</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

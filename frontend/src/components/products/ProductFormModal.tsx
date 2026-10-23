
"use client";

import {
  useEffect,
  useState,
  type FormEvent,
} from "react";

import {
  AlertCircle,
  LoaderCircle,
  PackagePlus,
  X,
} from "lucide-react";

import type {
  Product,
  ProductInput,
  ProductOptions,
} from "@/types/product";

interface Props {
  product: Product | null;
  options: ProductOptions;
  saving: boolean;
  onClose: () => void;
  onSubmit: (data: ProductInput) => Promise<void>;
}

const inputClass =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

const labelClass =
  "mb-1.5 block text-xs font-semibold text-slate-700";

export default function ProductFormModal({
  product,
  options,
  saving,
  onClose,
  onSubmit,
}: Props) {
  const [sku, setSku] = useState(product?.sku ?? "");
  const [name, setName] = useState(product?.name ?? "");
  const [code, setCode] = useState(product?.code ?? "");
  const [barcode, setBarcode] = useState(
    product?.barcode ?? ""
  );

  const [description, setDescription] = useState(
    product?.description ?? ""
  );

  const [imageUrl, setImageUrl] = useState(
    product?.imageUrl ?? ""
  );

  const [categoryId, setCategoryId] = useState(
    product?.categoryId ?? ""
  );

  const [brandId, setBrandId] = useState(
    product?.brandId ?? ""
  );

  const [unitId, setUnitId] = useState(
    product?.unitId ?? ""
  );

  const [minStock, setMinStock] = useState(
    String(product?.minStock ?? 0)
  );
  const [maxStock, setMaxStock] = useState(String(product?.maxStock ?? ""));
  const [reorderLeadDays, setReorderLeadDays] = useState(String(product?.reorderLeadDays ?? 7));

  const [trackBatch, setTrackBatch] = useState(
    product?.trackBatch ?? false
  );

  const [isActive, setIsActive] = useState(
    product?.isActive ?? true
  );

  const [formError, setFormError] = useState("");

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) {
        onClose();
      }
    }

    document.addEventListener(
      "keydown",
      handleEscape
    );

    return () => {
      document.removeEventListener(
        "keydown",
        handleEscape
      );
    };
  }, [saving, onClose]);

  // =====================================
  // SUBMIT ADD / EDIT PRODUCT
  // =====================================
  async function submit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();
    setFormError("");

    if (!sku.trim() || name.trim().length < 2) {
      setFormError(
        "SKU wajib diisi dan nama produk minimal 2 karakter."
      );
      return;
    }

    const qty = Number(minStock);
    const maxQty = maxStock.trim() === "" ? null : Number(maxStock);
    const leadDays = Number(reorderLeadDays);

    if (!Number.isInteger(qty) || qty < 0) {
      setFormError(
        "Minimum stock harus bilangan bulat 0 atau lebih."
      );
      return;
    }
    if (maxQty !== null && (!Number.isInteger(maxQty) || maxQty < qty)) {
      setFormError("Maximum stock harus bilangan bulat dan tidak boleh lebih kecil dari minimum stock.");
      return;
    }
    if (!Number.isInteger(leadDays) || leadDays < 0 || leadDays > 365) {
      setFormError("Lead time harus 0 sampai 365 hari.");
      return;
    }

    try {
      await onSubmit({
        sku: sku.trim().toUpperCase(),
        name: name.trim(),

        code: code.trim() || null,
        barcode: barcode.trim() || null,
        description: description.trim() || null,
        imageUrl: imageUrl.trim() || null,

        categoryId: categoryId || null,
        brandId: brandId || null,
        unitId: unitId || null,

        minStock: qty,
        maxStock: maxQty,
        reorderLeadDays: leadDays,
        trackBatch,
        isActive,
      });
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "Failed to save product"
      );
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
      onMouseDown={(event) => {
        if (
          event.target === event.currentTarget &&
          !saving
        ) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-dialog-title"
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        {/* MODAL HEADER */}
        <div className="flex items-start justify-between border-b border-slate-100 px-6 py-5">
          <div>
            <h2
              id="product-dialog-title"
              className="text-lg font-bold text-slate-900"
            >
              {product ? "Edit Product" : "Add New Product"}
            </h2>

            <p className="mt-1 text-xs text-slate-500">
              Isi detail produk. Stok dikelola terpisah
              pada modul Inventory.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close modal"
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50"
          >
            <X size={20} />
          </button>
        </div>

        {/* PRODUCT FORM */}
        <form
          onSubmit={submit}
          className="overflow-y-auto px-6 py-5"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {/* SKU */}
            <div>
              <label htmlFor="p-sku" className={labelClass}>
                Product SKU *
              </label>

              <input
                id="p-sku"
                className={inputClass}
                maxLength={40}
                required
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                placeholder="PRD-001"
              />
            </div>

            <div>
              <label htmlFor="p-max-stock" className={labelClass}>Maximum Stock (Target)</label>
              <input id="p-max-stock" className={inputClass} type="number" min={0} step={1} value={maxStock} onChange={(e) => setMaxStock(e.target.value)} placeholder="Optional" />
            </div>

            <div>
              <label htmlFor="p-lead-time" className={labelClass}>Supplier Lead Time (days)</label>
              <input id="p-lead-time" className={inputClass} type="number" min={0} max={365} step={1} value={reorderLeadDays} onChange={(e) => setReorderLeadDays(e.target.value)} />
            </div>

            {/* PRODUCT CODE */}
            <div>
              <label htmlFor="p-code" className={labelClass}>
                Product Code
              </label>

              <input
                id="p-code"
                className={inputClass}
                maxLength={60}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="LOG-M185"
              />
            </div>

            {/* NAME */}
            <div>
              <label htmlFor="p-name" className={labelClass}>
                Product Name *
              </label>

              <input
                id="p-name"
                className={inputClass}
                maxLength={120}
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Logitech Mouse M185"
              />
            </div>

            {/* BARCODE */}
            <div>
              <label
                htmlFor="p-barcode"
                className={labelClass}
              >
                Barcode
              </label>

              <input
                id="p-barcode"
                className={inputClass}
                maxLength={100}
                value={barcode}
                onChange={(e) =>
                  setBarcode(e.target.value)
                }
                placeholder="8991234567890"
              />
            </div>

            {/* CATEGORY */}
            <div>
              <label
                htmlFor="p-category"
                className={labelClass}
              >
                Category
              </label>

              <select
                id="p-category"
                className={inputClass}
                value={categoryId}
                onChange={(e) =>
                  setCategoryId(e.target.value)
                }
              >
                <option value="">— No Category —</option>

                {options.categories.map((item) => (
                  <option
                    key={item.id}
                    value={item.id}
                    disabled={
                      !item.isActive &&
                      item.id !== categoryId
                    }
                  >
                    {item.name}
                    {!item.isActive ? " (Inactive)" : ""}
                  </option>
                ))}
              </select>
            </div>

            {/* BRAND */}
            <div>
              <label
                htmlFor="p-brand"
                className={labelClass}
              >
                Brand
              </label>

              <select
                id="p-brand"
                className={inputClass}
                value={brandId}
                onChange={(e) =>
                  setBrandId(e.target.value)
                }
              >
                <option value="">— No Brand —</option>

                {options.brands.map((item) => (
                  <option
                    key={item.id}
                    value={item.id}
                    disabled={
                      !item.isActive &&
                      item.id !== brandId
                    }
                  >
                    {item.name}
                    {!item.isActive ? " (Inactive)" : ""}
                  </option>
                ))}
              </select>
            </div>

            {/* UNIT */}
            <div>
              <label
                htmlFor="p-unit"
                className={labelClass}
              >
                Unit
              </label>

              <select
                id="p-unit"
                className={inputClass}
                value={unitId}
                onChange={(e) =>
                  setUnitId(e.target.value)
                }
              >
                <option value="">— No Unit —</option>

                {options.units.map((item) => (
                  <option
                    key={item.id}
                    value={item.id}
                    disabled={
                      !item.isActive &&
                      item.id !== unitId
                    }
                  >
                    {item.code} — {item.name}
                    {!item.isActive ? " (Inactive)" : ""}
                  </option>
                ))}
              </select>
            </div>

            {/* MINIMUM STOCK */}
            <div>
              <label
                htmlFor="p-stock"
                className={labelClass}
              >
                Minimum Stock (Alert Qty)
              </label>

              <input
                id="p-stock"
                className={inputClass}
                type="number"
                min={0}
                step={1}
                required
                value={minStock}
                onChange={(e) =>
                  setMinStock(e.target.value)
                }
              />
            </div>

            {/* STATUS */}
            <div>
              <label
                htmlFor="p-active"
                className={labelClass}
              >
                Status
              </label>

              <select
                id="p-active"
                className={inputClass}
                value={
                  isActive ? "active" : "inactive"
                }
                onChange={(e) =>
                  setIsActive(
                    e.target.value === "active"
                  )
                }
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>

            <label className="flex items-center gap-3 rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3 sm:col-span-2">
              <input type="checkbox" checked={trackBatch} onChange={(event) => setTrackBatch(event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
              <span><span className="block text-sm font-semibold text-slate-800">Track batch & expiry</span><span className="mt-0.5 block text-xs text-slate-500">Receiving will require a batch number and stock will use FEFO reservation.</span></span>
            </label>

            {/* DESCRIPTION */}
            <div className="sm:col-span-2">
              <label
                htmlFor="p-description"
                className={labelClass}
              >
                Description
              </label>

              <textarea
                id="p-description"
                className={inputClass}
                maxLength={1000}
                rows={3}
                value={description}
                onChange={(e) =>
                  setDescription(e.target.value)
                }
                placeholder="Product details..."
              />
            </div>

            {/* IMAGE URL */}
            <div className="sm:col-span-2">
              <label
                htmlFor="p-image"
                className={labelClass}
              >
                Image URL
              </label>

              <input
                id="p-image"
                className={inputClass}
                type="url"
                value={imageUrl}
                onChange={(e) =>
                  setImageUrl(e.target.value)
                }
                placeholder="https://example.com/product.png"
              />
            </div>
          </div>

          {/* MASTER DATA NOTICE */}
          {(
            options.brands.length === 0 ||
            options.units.length === 0
          ) && (
            <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Jika Brand atau Unit masih kosong,
              isi master data melalui Prisma Studio.
              Field ini sementara boleh kosong.
            </p>
          )}

          {/* ERROR */}
          {formError && (
            <div
              role="alert"
              className="mt-4 flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700"
            >
              <AlertCircle size={16} />
              {formError}
            </div>
          )}

          {/* FOOTER */}
          <div className="sticky bottom-0 mt-6 flex justify-end gap-3 border-t border-slate-100 bg-white py-4">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-lg border border-slate-200 px-5 py-2.5 text-sm font-medium text-slate-700 disabled:opacity-50"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-[#3867f6] px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? (
                <LoaderCircle
                  size={16}
                  className="animate-spin"
                />
              ) : (
                <PackagePlus size={16} />
              )}

              {saving
                ? "Saving..."
                : product
                  ? "Update Product"
                  : "Save Product"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

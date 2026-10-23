
"use client";

import { useEffect, useId, useMemo, useState } from "react";
import {
  LoaderCircle,
  Plus,
  Trash2,
  X,
} from "lucide-react";

import { returnService } from "@/services/return.service";

import type {
  CreateReturnPayload,
  LocationType,
  ReturnCondition,
  ReturnDisposition,
  ReturnItemPayload,
  ReturnOptions,
  ReturnRecord,
  ReturnType,
  SourceDocument,
} from "@/types/returns";

const box =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500";

const emptyLine = (): ReturnItemPayload => ({
  productId: "",
  locationId: "",
  batchId: null,
  quantity: 1,
  condition: "GOOD",
  disposition: "RESTOCK",
  notes: null,
});

export default function ReturnFormModal({
  type,
  editing,
  onClose,
  onSaved,
}: {
  type: ReturnType;
  editing?: ReturnRecord | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [sources, setSources] = useState<SourceDocument[]>([]);
  const [options, setOptions] = useState<ReturnOptions>({
    warehouses: [],
    locations: [],
    batches: [],
    products: [],
  });

  const [loading, setLoading] = useState(!editing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [sourceId, setSourceId] = useState("");

  const stableReturnId = useId().replaceAll(":", "").slice(-8).toUpperCase();
  const [number, setNumber] = useState(
    `${type === "PURCHASE" ? "PR" : "SR"}-${new Date()
      .toISOString()
      .slice(0, 10)
      .replaceAll("-", "")}-${stableReturnId}`
  );

  const [reason, setReason] = useState(
    editing?.reason ?? ""
  );

  const [notes, setNotes] = useState(
    editing?.notes ?? ""
  );

  const [items, setItems] = useState<
    ReturnItemPayload[]
  >([emptyLine()]);

  useEffect(() => {
    if (editing) return;

    let active = true;

    Promise.all([
      returnService.sources(type),
      returnService.options(),
    ])
      .then(([s, o]) => {
        if (active) {
          setSources(s);
          setOptions(o);
        }
      })
      .catch((e) => {
        if (active) {
          setError(
            e instanceof Error
              ? e.message
              : "Cannot load options"
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [type, editing]);

  const source = useMemo(
    () => sources.find((s) => s.id === sourceId),
    [sources, sourceId]
  );

  const locations = options.locations.filter(
    (x) => x.warehouseId === source?.warehouseId
  );

  const productOf = (id: string) =>
    source?.items.find((i) => i.productId === id)
      ?.product ??
    options.products.find((x) => x.id === id);

  const sourceLine = (id: string) =>
    source?.items.find((i) => i.id === id);

  const rowKey =
    type === "PURCHASE"
      ? "purchaseOrderItemId"
      : "saleItemId";

  function changeItem(
    index: number,
    changes: Partial<ReturnItemPayload>
  ) {
    setItems((old) =>
      old.map((item, i) =>
        i === index
          ? { ...item, ...changes }
          : item
      )
    );
  }

  function changeSource(id: string) {
    setSourceId(id);
    setItems([emptyLine()]);
  }

  function selectSourceItem(
    index: number,
    id: string
  ) {
    const item = sourceLine(id);

    changeItem(index, {
      [rowKey]: id,
      productId: item?.productId ?? "",
      locationId: "",
      batchId: null,
    } as Partial<ReturnItemPayload>);
  }

  function requiredLocation(
    disposition: ReturnDisposition
  ): LocationType {
    if (
      type === "PURCHASE" ||
      disposition === "RESTOCK"
    ) {
      return "STORAGE";
    }

    return disposition === "QUARANTINE"
      ? "QUARANTINE"
      : "DAMAGED";
  }

  async function save() {
    setError("");

    if (reason.trim().length < 3) {
      setError(
        "Reason must have at least 3 characters"
      );
      return;
    }

    if (
      !editing &&
      (
        !source ||
        !items.length ||
        items.some(
          (i) =>
            !i.productId ||
            !i.locationId ||
            !i[rowKey] ||
            !Number.isInteger(i.quantity) ||
            i.quantity <= 0 ||
            (
              Boolean(productOf(i.productId)?.trackBatch) &&
              !i.batchId
            )
        )
      )
    ) {
      setError(
        "Choose a source, item, location, valid quantity and batch where required"
      );
      return;
    }

    setSaving(true);

    try {
      if (editing) {
        await returnService.update(editing.id, {
          reason: reason.trim(),
          notes: notes.trim() || null,
        });
      } else {
        const payload: CreateReturnPayload = {
          number,
          warehouseId: source!.warehouseId,
          reason: reason.trim(),
          notes: notes.trim() || null,
          items: items.map((i) => ({
            ...i,
            notes: i.notes || null,
          })),
          ...(type === "PURCHASE"
            ? { purchaseOrderId: sourceId }
            : { saleId: sourceId }),
        };

        await returnService.create(type, payload);
      }

      onSaved();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Failed to save return"
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-3"
      onMouseDown={(e) => {
        if (
          e.target === e.currentTarget &&
          !saving
        ) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Return form"
        className="max-h-[94vh] w-full max-w-4xl overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl sm:p-7"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-900">
              {editing
                ? "Edit draft"
                : `Create ${
                    type === "PURCHASE"
                      ? "Purchase"
                      : "Sales"
                  } Return`}
            </h2>

            <p className="mt-1 text-xs text-slate-500">
              Stock is not changed until approval
              and posting.
            </p>
          </div>

          <button
            aria-label="Close"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg p-2 hover:bg-slate-100"
          >
            <X size={20} />
          </button>
        </div>

        {error && (
          <p
            role="alert"
            className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700"
          >
            {error}
          </p>
        )}

        {loading ? (
          <div className="flex items-center gap-2 py-12 text-slate-500">
            <LoaderCircle className="animate-spin" />
            Loading sources...
          </div>
        ) : (
          <div className="mt-5 space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              {!editing && (
                <>
                  <label className="text-xs font-semibold text-slate-600">
                    Return number

                    <input
                      className={`${box} mt-1`}
                      value={number}
                      onChange={(e) =>
                        setNumber(e.target.value)
                      }
                      maxLength={100}
                    />
                  </label>

                  <label className="text-xs font-semibold text-slate-600">
                    {type === "PURCHASE"
                      ? "Purchase Order"
                      : "Sale"}

                    <select
                      className={`${box} mt-1`}
                      value={sourceId}
                      onChange={(e) =>
                        changeSource(e.target.value)
                      }
                    >
                      <option value="">
                        Select source transaction
                      </option>

                      {sources.map((s) => (
                        <option
                          key={s.id}
                          value={s.id}
                        >
                          {s.number} — {s.status}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}

              <label className="text-xs font-semibold text-slate-600">
                Reason

                <textarea
                  className={`${box} mt-1`}
                  rows={2}
                  value={reason}
                  maxLength={2000}
                  onChange={(e) =>
                    setReason(e.target.value)
                  }
                />
              </label>

              <label className="text-xs font-semibold text-slate-600">
                Notes

                <textarea
                  className={`${box} mt-1`}
                  rows={2}
                  value={notes}
                  maxLength={2000}
                  onChange={(e) =>
                    setNotes(e.target.value)
                  }
                />
              </label>
            </div>

            {!editing && source && (
              <>
                <p className="text-sm text-slate-500">
                  Warehouse:{" "}
                  <strong>
                    {options.warehouses.find(
                      (w) =>
                        w.id === source.warehouseId
                    )?.name ?? source.warehouseId}
                  </strong>
                </p>

                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-slate-800">
                    Return items
                  </h3>

                  <button
                    onClick={() =>
                      setItems((old) => [
                        ...old,
                        emptyLine(),
                      ])
                    }
                    className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700"
                  >
                    <Plus size={14} />
                    Add item
                  </button>
                </div>

                {items.map((item, index) => {
                  const selected = sourceLine(
                    item[rowKey] ?? ""
                  );

                  const track = Boolean(
                    productOf(item.productId)
                      ?.trackBatch
                  );

                  const availableBatches =
                    options.batches.filter(
                      (b) =>
                        b.productId ===
                          item.productId &&
                        b.warehouseId ===
                          source.warehouseId
                    );

                  const locationType =
                    requiredLocation(
                      item.disposition
                    );

                  return (
                    <div
                      key={index}
                      className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                    >
                      <div className="mb-3 flex justify-between">
                        <strong className="text-sm">
                          Item {index + 1}
                        </strong>

                        <button
                          disabled={
                            items.length === 1
                          }
                          onClick={() =>
                            setItems((old) =>
                              old.filter(
                                (_, i) =>
                                  i !== index
                              )
                            )
                          }
                          className="text-rose-600 disabled:opacity-30"
                          aria-label="Remove item"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-3">
                        <label className="text-xs text-slate-500">
                          Source product

                          <select
                            value={
                              item[rowKey] ?? ""
                            }
                            onChange={(e) =>
                              selectSourceItem(
                                index,
                                e.target.value
                              )
                            }
                            className={`${box} mt-1`}
                          >
                            <option value="">
                              Select product
                            </option>

                            {source.items.map(
                              (line) => (
                                <option
                                  key={line.id}
                                  value={line.id}
                                >
                                  {line.product?.name ??
                                    line.productId}{" "}
                                  (
                                  {type ===
                                  "PURCHASE"
                                    ? line.receivedQuantity ??
                                      0
                                    : line.quantity}{" "}
                                  units)
                                </option>
                              )
                            )}
                          </select>
                        </label>

                        <label className="text-xs text-slate-500">
                          Quantity

                          <input
                            type="number"
                            min={1}
                            max={
                              type ===
                              "PURCHASE"
                                ? selected?.receivedQuantity ??
                                  undefined
                                : selected?.quantity ??
                                  undefined
                            }
                            value={item.quantity}
                            onChange={(e) =>
                              changeItem(
                                index,
                                {
                                  quantity:
                                    Number(
                                      e.target.value
                                    ),
                                }
                              )
                            }
                            className={`${box} mt-1`}
                          />
                        </label>

                        <label className="text-xs text-slate-500">
                          Condition

                          <select
                            value={item.condition}
                            onChange={(e) =>
                              changeItem(
                                index,
                                {
                                  condition:
                                    e.target
                                      .value as ReturnCondition,
                                }
                              )
                            }
                            className={`${box} mt-1`}
                          >
                            {[
                              "GOOD",
                              "DAMAGED",
                              "EXPIRED",
                              "DEFECTIVE",
                            ].map((v) => (
                              <option key={v}>
                                {v}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="text-xs text-slate-500">
                          Disposition

                          <select
                            value={
                              item.disposition
                            }
                            disabled={
                              type === "PURCHASE"
                            }
                            onChange={(e) =>
                              changeItem(
                                index,
                                {
                                  disposition:
                                    e.target
                                      .value as ReturnDisposition,
                                  locationId: "",
                                }
                              )
                            }
                            className={`${box} mt-1`}
                          >
                            {(type === "PURCHASE"
                              ? ["RESTOCK"]
                              : [
                                  "RESTOCK",
                                  "QUARANTINE",
                                  "SCRAP",
                                ]
                            ).map((v) => (
                              <option key={v}>
                                {v}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="text-xs text-slate-500">
                          Location ({locationType})

                          <select
                            value={
                              item.locationId
                            }
                            onChange={(e) =>
                              changeItem(
                                index,
                                {
                                  locationId:
                                    e.target
                                      .value,
                                }
                              )
                            }
                            className={`${box} mt-1`}
                          >
                            <option value="">
                              Select location
                            </option>

                            {locations
                              .filter(
                                (l) =>
                                  l.locationType ===
                                  locationType
                              )
                              .map((l) => (
                                <option
                                  key={l.id}
                                  value={l.id}
                                >
                                  {l.code ??
                                    l.name}{" "}
                                  — {l.name}
                                </option>
                              ))}
                          </select>
                        </label>

                        <label className="text-xs text-slate-500">
                          Batch{" "}
                          {track
                            ? "(required)"
                            : "(not used)"}

                          <select
                            value={
                              item.batchId ?? ""
                            }
                            disabled={!track}
                            onChange={(e) =>
                              changeItem(
                                index,
                                {
                                  batchId:
                                    e.target
                                      .value ||
                                    null,
                                }
                              )
                            }
                            className={`${box} mt-1`}
                          >
                            <option value="">
                              Select batch
                            </option>

                            {availableBatches.map(
                              (b) => (
                                <option
                                  key={b.id}
                                  value={b.id}
                                >
                                  {b.batchNumber}
                                </option>
                              )
                            )}
                          </select>
                        </label>

                        <label className="text-xs text-slate-500 sm:col-span-3">
                          Item notes

                          <input
                            value={
                              item.notes ?? ""
                            }
                            onChange={(e) =>
                              changeItem(
                                index,
                                {
                                  notes:
                                    e.target
                                      .value ||
                                    null,
                                }
                              )
                            }
                            className={`${box} mt-1`}
                          />
                        </label>
                      </div>
                    </div>
                  );
                })}

                <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
                  Batch provenance and cumulative
                  return quantity are validated
                  by the server. Source lists
                  are limited to the most recent
                  100 records; prior transactions
                  may require a backend lookup
                  endpoint.
                </p>
              </>
            )}

            <div className="flex justify-end gap-2 border-t border-slate-100 pt-5">
              <button
                onClick={onClose}
                disabled={saving}
                className="rounded-xl border px-4 py-2 text-sm"
              >
                Cancel
              </button>

              <button
                onClick={() => void save()}
                disabled={
                  saving ||
                  (!editing && !source)
                }
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                {saving && (
                  <LoaderCircle
                    size={15}
                    className="animate-spin"
                  />
                )}

                {editing
                  ? "Save changes"
                  : "Create draft"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

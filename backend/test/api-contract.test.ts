import "dotenv/config";

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createCategorySchema } from "../src/modules/categories/category.validation.ts";
import { createShipmentSchema, fulfillmentListQuerySchema, pickShipmentSchema, shipShipmentSchema } from "../src/modules/fulfillment/fulfillment.validation.ts";
import { adjustmentListQuerySchema, expenseListQuerySchema, paymentListQuerySchema, purchaseListQuerySchema, saleListQuerySchema, transferListQuerySchema } from "../src/modules/operations/operations.validation.ts";

const contract = JSON.parse(await readFile(new URL("../openapi.json", import.meta.url), "utf8")) as {
  openapi: string;
  paths: Record<string, Record<string, { operationId?: string; parameters?: { name: string; in: string; schema?: { enum?: string[] } }[]; requestBody?: { content?: { "application/json"?: { schema?: { $ref?: string } } } } }>>;
  components: { schemas: Record<string, { enum?: string[]; required?: string[]; properties?: Record<string, { type?: string | string[]; minLength?: number; maxLength?: number; minimum?: number; maximum?: number; minItems?: number; maxItems?: number; items?: { enum?: string[]; properties?: Record<string, { minimum?: number }> } }> }> };
};

test("OpenAPI contract covers critical routes and shares fulfillment validation constraints", () => {
  assert.equal(contract.openapi, "3.1.0");
  for (const [path, method] of [
    ["/health", "get"], ["/ready", "get"], ["/auth/login", "post"], ["/auth/me", "get"], ["/categories", "post"],
    ["/fulfillment", "get"], ["/fulfillment/scan", "get"],
    ["/fulfillment/sales/{saleId}/shipments", "post"], ["/fulfillment/{id}/pick", "post"], ["/fulfillment/{id}/ship", "post"], ["/fulfillment/{id}/complete", "post"], ["/fulfillment/{id}/cancel", "post"],
    ["/operations/workflow/{kind}/{id}/history", "get"],
    ["/operations/purchases", "get"], ["/operations/sales", "get"], ["/operations/adjustments", "get"],
    ["/operations/transfers", "get"], ["/operations/expenses", "get"], ["/operations/payments", "get"],
    ["/stock-opnames", "post"], ["/stock-opnames/{id}", "get"], ["/stock-opnames/{id}/lines/{lineId}", "patch"], ["/stock-opnames/{id}/submit", "post"], ["/stock-opnames/{id}/approve", "post"],
  ]) {
    assert.ok(contract.paths[path]?.[method], `Missing documented operation ${method.toUpperCase()} ${path}`);
  }

  const statusEnum = contract.components.schemas.FulfillmentStatus.enum;
  assert.ok(statusEnum);
  for (const status of statusEnum) {
    assert.doesNotThrow(() => fulfillmentListQuerySchema.parse({ status }));
  }
  assert.throws(() => fulfillmentListQuerySchema.parse({ status: "UNKNOWN" }));

  const workflowActions = contract.components.schemas.WorkflowHistoryResponse.properties?.actions;
  assert.deepEqual(workflowActions?.items?.enum, ["approve", "reject", "releaseReservation"]);

  const listContracts = [
    ["/operations/purchases", purchaseListQuerySchema, ["DRAFT", "PENDING", "APPROVED", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"]],
    ["/operations/sales", saleListQuerySchema, ["DRAFT", "RESERVED", "PICKING", "PACKED", "PARTIALLY_SHIPPED", "SHIPPED", "COMPLETED", "CANCELLED"]],
    ["/operations/adjustments", adjustmentListQuerySchema, ["DRAFT", "REVISION", "POSTED", "CANCELLED"]],
    ["/operations/transfers", transferListQuerySchema, ["DRAFT", "REVISION", "IN_TRANSIT", "COMPLETED", "CANCELLED"]],
    ["/operations/expenses", expenseListQuerySchema, ["PAID", "UNPAID"]],
    ["/operations/payments", paymentListQuerySchema, ["PENDING", "PAID", "VOID"]],
  ] as const;
  for (const [path, querySchema, statuses] of listContracts) {
    const parameters = contract.paths[path]?.get?.parameters ?? [];
    assert.deepEqual(parameters.map((parameter) => parameter.name).sort(), ["fromDate", "page", "pageSize", "search", "status", "toDate"]);
    assert.ok(parameters.every((parameter) => parameter.in === "query"));
    assert.deepEqual(parameters.find((parameter) => parameter.name === "status")?.schema?.enum, statuses);
    assert.doesNotThrow(() => querySchema.parse({ page: "2", pageSize: "20", status: statuses[0] }));
  }

  const shipmentSchema = contract.components.schemas.CreateShipmentRequest;
  assert.deepEqual(shipmentSchema.required, ["items"]);
  assert.deepEqual(Object.keys(shipmentSchema.properties ?? {}).sort(), ["items", "notes", "number", "shippingAddress"]);
  assert.equal(shipmentSchema.properties?.items?.type, "array");
  assert.equal(shipmentSchema.properties?.items?.minItems, 1);
  assert.equal(shipmentSchema.properties?.items?.maxItems, 200);
  assert.equal(shipmentSchema.properties?.items?.items?.properties?.quantity?.minimum, 1);
  const id = "d69c3a3d-665f-496e-9425-ffbba20de745";
  assert.doesNotThrow(() => createShipmentSchema.parse({ items: [{ saleItemId: id, quantity: 1 }] }));
  assert.throws(() => createShipmentSchema.parse({ items: [{ saleItemId: id, quantity: 0 }] }));

  const pickSchema = contract.components.schemas.PickShipmentRequest;
  assert.equal(pickSchema.properties?.items?.items?.properties?.quantity?.minimum, 0);
  assert.doesNotThrow(() => pickShipmentSchema.parse({ items: [{ shipmentItemId: id, quantity: 0 }] }));
  assert.throws(() => pickShipmentSchema.parse({ items: [{ shipmentItemId: id, quantity: -1 }] }));

  const shipSchema = contract.components.schemas.ShipShipmentRequest;
  assert.deepEqual(shipSchema.required, ["courier", "trackingNumber"]);
  assert.doesNotThrow(() => shipShipmentSchema.parse({ courier: "JNE", trackingNumber: "TRK-001" }));
  assert.throws(() => shipShipmentSchema.parse({ courier: "J", trackingNumber: "T" }));

  const categorySchema = contract.components.schemas.CreateCategoryRequest;
  assert.deepEqual(categorySchema.required, ["name"]);
  assert.equal(categorySchema.properties?.name?.minLength, 2);
  assert.equal(categorySchema.properties?.name?.maxLength, 100);
  assert.doesNotThrow(() => createCategorySchema.parse({ name: "Bahan baku" }));
  assert.throws(() => createCategorySchema.parse({ name: "A" }));
});

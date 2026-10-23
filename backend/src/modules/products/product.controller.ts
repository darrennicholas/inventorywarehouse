
import { z } from "zod";

import { AppError } from "../../utils/AppError.ts";
import { asyncHandler } from "../../utils/asyncHandler.ts";

import { productService } from "./product.service.ts";
import { authOf } from "../../middlewares/auth.middleware.ts";
import { writeAuditLog } from "../audit/audit.service.ts";
import { notifyByPermission } from "../notifications/notification.service.ts";
import { paginateArray } from "../../utils/pagination.ts";

import type {
  CreateProductInput,
  UpdateProductInput,
} from "./product.validation.ts";

// =====================================
// VALIDATE PRODUCT ID
// =====================================

function validId(raw: unknown): string {
  if (
    typeof raw !== "string" ||
    !z.uuid().safeParse(raw).success
  ) {
    throw new AppError(
      400,
      "Invalid product ID"
    );
  }

  return raw;
}

// =====================================
// GET /api/products
// =====================================

export const listProducts = asyncHandler(
  async (req, res) => {
    const products = await productService.list();
    const result = paginateArray(products, req.query as Record<string, unknown>);

    res.status(200).json({
      success: true,
      message: "Products retrieved successfully",
      ...result,
    });
  }
);

// =====================================
// GET /api/products/options
// =====================================

export const getProductOptions = asyncHandler(
  async (_req, res) => {
    const options = await productService.options();

    res.status(200).json({
      success: true,
      data: options,
    });
  }
);

// =====================================
// GET /api/products/:id
// =====================================

export const getProduct = asyncHandler(
  async (req, res) => {
    const id = validId(req.params.id);

    const product = await productService.detail(id);

    res.status(200).json({
      success: true,
      message: "Product retrieved successfully",
      data: product,
    });
  }
);

// =====================================
// POST /api/products
// =====================================

export const createProduct = asyncHandler(
  async (req, res) => {
    const input = req.body as CreateProductInput;

    const product = await productService.create(input);
    await writeAuditLog({ userId: authOf(req).userId, action: "CREATE", entity: "Product", entityId: product.id, afterData: product, requestId: res.locals.requestId as string | undefined, ipAddress: req.ip, userAgent: req.get("user-agent") });
    await notifyByPermission({ permission: "products.read", type: "PRODUCT_CREATED", title: "New product added", message: `${product.name} (${product.sku}) is now available in the catalog.`, entity: "Product", entityId: product.id });

    res.status(201).json({
      success: true,
      message: "Product created successfully",
      data: product,
    });
  }
);

// =====================================
// PATCH /api/products/:id
// =====================================

export const updateProduct = asyncHandler(
  async (req, res) => {
    const id = validId(req.params.id);

    const input = req.body as UpdateProductInput;

    const product = await productService.update(
      id,
      input
    );
    await writeAuditLog({ userId: authOf(req).userId, action: "UPDATE", entity: "Product", entityId: product.id, afterData: product, requestId: res.locals.requestId as string | undefined, ipAddress: req.ip, userAgent: req.get("user-agent") });
    await notifyByPermission({ permission: "products.read", type: "PRODUCT_UPDATED", title: "Product updated", message: `${product.name} was updated.`, entity: "Product", entityId: product.id });

    res.status(200).json({
      success: true,
      message: "Product updated successfully",
      data: product,
    });
  }
);

// =====================================
// DELETE /api/products/:id
// =====================================

export const deactivateProduct = asyncHandler(
  async (req, res) => {
    const id = validId(req.params.id);

    const product =
      await productService.deactivate(id);
    await writeAuditLog({ userId: authOf(req).userId, action: "DEACTIVATE", entity: "Product", entityId: product.id, afterData: product, requestId: res.locals.requestId as string | undefined, ipAddress: req.ip, userAgent: req.get("user-agent") });
    await notifyByPermission({ permission: "products.read", type: "PRODUCT_DEACTIVATED", title: "Product deactivated", message: `${product.name} was deactivated.`, entity: "Product", entityId: product.id });

    res.status(200).json({
      success: true,
      message: "Product deactivated successfully",
      data: product,
    });
  }
);

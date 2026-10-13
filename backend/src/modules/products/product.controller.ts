
import { z } from "zod";

import { AppError } from "../../utils/AppError.ts";
import { asyncHandler } from "../../utils/asyncHandler.ts";

import { productService } from "./product.service.ts";

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
  async (_req, res) => {
    const products = await productService.list();

    res.status(200).json({
      success: true,
      message: "Products retrieved successfully",
      data: products,
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

    res.status(200).json({
      success: true,
      message: "Product deactivated successfully",
      data: product,
    });
  }
);

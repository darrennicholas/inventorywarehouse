
import { asyncHandler } from "../../utils/asyncHandler.ts";
import { requireUuid } from "../../utils/requireUuid.ts";

import { brandService } from "./brand.service.ts";
import { notifyByPermission } from "../notifications/notification.service.ts";
import { paginateArray } from "../../utils/pagination.ts";

import type {
  CreateBrandInput,
  UpdateBrandInput,
} from "./brand.validation.ts";

export const getBrands = asyncHandler(
  async (req, res) => {
    const data = await brandService.list();
    const result = paginateArray(data, req.query as Record<string, unknown>);

    res.status(200).json({
      success: true,
      ...result,
    });
  }
);

export const getBrandById = asyncHandler(
  async (req, res) => {
    const id = requireUuid(req.params.id, "Brand ID");
    const data = await brandService.detail(id);

    res.status(200).json({
      success: true,
      data,
    });
  }
);

export const createBrand = asyncHandler(
  async (req, res) => {
    const data = await brandService.create(
      req.body as CreateBrandInput
    );
    await notifyByPermission({ permission: "brands.read", type: "BRAND_CREATED", title: "Brand created", message: `${data.name} was added to product master data.`, entity: "Brand", entityId: data.id });

    res.status(201).json({
      success: true,
      message: "Brand created successfully",
      data,
    });
  }
);

export const updateBrand = asyncHandler(
  async (req, res) => {
    const id = requireUuid(req.params.id, "Brand ID");

    const data = await brandService.update(
      id,
      req.body as UpdateBrandInput
    );
    await notifyByPermission({ permission: "brands.read", type: "BRAND_UPDATED", title: "Brand updated", message: `${data.name} was updated.`, entity: "Brand", entityId: data.id });

    res.status(200).json({
      success: true,
      message: "Brand updated successfully",
      data,
    });
  }
);

export const deactivateBrand = asyncHandler(
  async (req, res) => {
    const id = requireUuid(req.params.id, "Brand ID");
    const data = await brandService.deactivate(id);
    await notifyByPermission({ permission: "brands.read", type: "BRAND_DEACTIVATED", title: "Brand deactivated", message: `${data.name} was deactivated.`, entity: "Brand", entityId: data.id });

    res.status(200).json({
      success: true,
      message: "Brand deactivated successfully",
      data,
    });
  }
);

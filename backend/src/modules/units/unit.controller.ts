
import { asyncHandler } from "../../utils/asyncHandler.ts";
import { requireUuid } from "../../utils/requireUuid.ts";

import { unitService } from "./unit.service.ts";
import { notifyByPermission } from "../notifications/notification.service.ts";
import { paginateArray } from "../../utils/pagination.ts";

import type {
  CreateUnitInput,
  UpdateUnitInput,
} from "./unit.validation.ts";

export const getUnits = asyncHandler(
  async (req, res) => {
    const data = await unitService.list();
    const result = paginateArray(data, req.query as Record<string, unknown>);

    res.status(200).json({
      success: true,
      ...result,
    });
  }
);

export const getUnitById = asyncHandler(
  async (req, res) => {
    const id = requireUuid(req.params.id, "Unit ID");
    const data = await unitService.detail(id);

    res.status(200).json({
      success: true,
      data,
    });
  }
);

export const createUnit = asyncHandler(
  async (req, res) => {
    const data = await unitService.create(
      req.body as CreateUnitInput
    );
    await notifyByPermission({ permission: "units.read", type: "UNIT_CREATED", title: "Unit created", message: `${data.code} was added to product master data.`, entity: "Unit", entityId: data.id });

    res.status(201).json({
      success: true,
      message: "Unit created successfully",
      data,
    });
  }
);

export const updateUnit = asyncHandler(
  async (req, res) => {
    const id = requireUuid(req.params.id, "Unit ID");

    const data = await unitService.update(
      id,
      req.body as UpdateUnitInput
    );
    await notifyByPermission({ permission: "units.read", type: "UNIT_UPDATED", title: "Unit updated", message: `${data.code} was updated.`, entity: "Unit", entityId: data.id });

    res.status(200).json({
      success: true,
      message: "Unit updated successfully",
      data,
    });
  }
);

export const deactivateUnit = asyncHandler(
  async (req, res) => {
    const id = requireUuid(req.params.id, "Unit ID");
    const data = await unitService.deactivate(id);
    await notifyByPermission({ permission: "units.read", type: "UNIT_DEACTIVATED", title: "Unit deactivated", message: `${data.code} was deactivated.`, entity: "Unit", entityId: data.id });

    res.status(200).json({
      success: true,
      message: "Unit deactivated successfully",
      data,
    });
  }
);

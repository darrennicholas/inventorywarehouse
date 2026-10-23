
import { asyncHandler } from "../../utils/asyncHandler.ts";
import { requireUuid } from "../../utils/requireUuid.ts";

import { staffService } from "./staff.service.ts";
import { notifyByPermission } from "../notifications/notification.service.ts";
import { paginateArray } from "../../utils/pagination.ts";

import type {
  CreateStaffInput,
  UpdateStaffInput,
} from "./staff.validation.ts";

// ======================================
// GET ALL STAFF
// ======================================

export const getStaff = asyncHandler(
  async (req, res) => {
    const data = await staffService.list();
    const result = paginateArray(data, req.query as Record<string, unknown>);

    res.status(200).json({
      success: true,
      ...result,
    });
  }
);

// ======================================
// GET STAFF BY ID
// ======================================

export const getStaffById = asyncHandler(
  async (req, res) => {
    const id = requireUuid(
      req.params.id,
      "Staff ID"
    );

    const data = await staffService.detail(id);

    res.status(200).json({
      success: true,
      data,
    });
  }
);

// ======================================
// CREATE STAFF
// ======================================

export const createStaff = asyncHandler(
  async (req, res) => {
    const input =
      req.body as CreateStaffInput;

    const data = await staffService.create(input);
    await notifyByPermission({ permission: "staff.read", type: "STAFF_CREATED", title: "Staff profile created", message: `${data.fullName} was added to staff records.`, entity: "Staff", entityId: data.id, warehouseId: data.warehouseId ?? undefined });

    res.status(201).json({
      success: true,
      message: "Staff created successfully",
      data,
    });
  }
);

// ======================================
// UPDATE STAFF
// ======================================

export const updateStaff = asyncHandler(
  async (req, res) => {
    const id = requireUuid(
      req.params.id,
      "Staff ID"
    );

    const input =
      req.body as UpdateStaffInput;

    const data = await staffService.update(
      id,
      input
    );
    await notifyByPermission({ permission: "staff.read", type: "STAFF_UPDATED", title: "Staff profile updated", message: `${data.fullName} was updated.`, entity: "Staff", entityId: data.id, warehouseId: data.warehouseId ?? undefined });

    res.status(200).json({
      success: true,
      message: "Staff updated successfully",
      data,
    });
  }
);

// ======================================
// DEACTIVATE STAFF
// ======================================

export const deactivateStaff = asyncHandler(
  async (req, res) => {
    const id = requireUuid(
      req.params.id,
      "Staff ID"
    );

    const data =
      await staffService.deactivate(id);
    await notifyByPermission({ permission: "staff.read", type: "STAFF_DEACTIVATED", title: "Staff profile deactivated", message: `${data.fullName} was deactivated.`, entity: "Staff", entityId: data.id, warehouseId: data.warehouseId ?? undefined });

    res.status(200).json({
      success: true,
      message: "Staff deactivated successfully",
      data,
    });
  }
);

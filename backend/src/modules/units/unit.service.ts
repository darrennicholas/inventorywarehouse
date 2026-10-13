
import { AppError } from "../../utils/AppError.ts";
import { unitRepository } from "./unit.repository.ts";

import type {
  CreateUnitInput,
  UpdateUnitInput,
} from "./unit.validation.ts";

export const unitService = {
  list() {
    return unitRepository.findAll();
  },

  async detail(id: string) {
    const unit = await unitRepository.findById(id);

    if (!unit) {
      throw new AppError(404, "Unit not found");
    }

    return unit;
  },

  async create(data: CreateUnitInput) {
    const existing = await unitRepository.findByCode(
      data.code
    );

    if (existing) {
      throw new AppError(
        409,
        "Unit code already exists"
      );
    }

    return unitRepository.create(data);
  },

  async update(id: string, data: UpdateUnitInput) {
    const current = await unitService.detail(id);

    if (data.code !== undefined) {
      const existing = await unitRepository.findByCode(
        data.code
      );

      if (existing && existing.id !== id) {
        throw new AppError(
          409,
          "Unit code already exists"
        );
      }
    }

    if (
      current.isActive &&
      data.isActive === false
    ) {
      const used = await unitRepository.countActiveProducts(
        id
      );

      if (used > 0) {
        throw new AppError(
          409,
          `Cannot deactivate Unit used by ${used} active product(s)`
        );
      }
    }

    return unitRepository.update(id, data);
  },

  async deactivate(id: string) {
    return unitService.update(id, {
      isActive: false,
    });
  },
};

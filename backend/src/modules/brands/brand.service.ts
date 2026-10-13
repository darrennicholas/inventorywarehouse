
import { AppError } from "../../utils/AppError.ts";
import { brandRepository } from "./brand.repository.ts";

import type {
  CreateBrandInput,
  UpdateBrandInput,
} from "./brand.validation.ts";

export const brandService = {
  list() {
    return brandRepository.findAll();
  },

  async detail(id: string) {
    const brand = await brandRepository.findById(id);

    if (!brand) {
      throw new AppError(404, "Brand not found");
    }

    return brand;
  },

  async create(data: CreateBrandInput) {
    const existing = await brandRepository.findByName(
      data.name
    );

    if (existing) {
      throw new AppError(
        409,
        "Brand name already exists"
      );
    }

    return brandRepository.create(data);
  },

  async update(id: string, data: UpdateBrandInput) {
    const current = await brandService.detail(id);

    if (data.name !== undefined) {
      const existing = await brandRepository.findByName(
        data.name
      );

      if (existing && existing.id !== id) {
        throw new AppError(
          409,
          "Brand name already exists"
        );
      }
    }

    if (
      current.isActive &&
      data.isActive === false
    ) {
      const used = await brandRepository.countActiveProducts(
        id
      );

      if (used > 0) {
        throw new AppError(
          409,
          `Cannot deactivate Brand used by ${used} active product(s)`
        );
      }
    }

    return brandRepository.update(id, data);
  },

  async deactivate(id: string) {
    return brandService.update(id, {
      isActive: false,
    });
  },
};

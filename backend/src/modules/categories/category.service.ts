
import { AppError } from "../../utils/AppError.ts";
import { categoryRepository } from "./category.repository.ts";

import type {
  CreateCategoryInput,
  UpdateCategoryInput,
} from "./category.validation.ts";

export const categoryService = {
  async getAll() {
    return categoryRepository.findAll();
  },

  async getById(id: string) {
    const category = await categoryRepository.findById(id);

    if (!category) {
      throw new AppError(404, "Category not found");
    }

    return category;
  },

  async create(data: CreateCategoryInput) {
    const existing =
      await categoryRepository.findByName(data.name);

    if (existing) {
      throw new AppError(
        409,
        "Category name already exists"
      );
    }

    return categoryRepository.create(data);
  },

  async update(id: string, data: UpdateCategoryInput) {
    await this.getById(id);

    if (data.name !== undefined) {
      const existing =
        await categoryRepository.findByName(data.name);

      if (existing && existing.id !== id) {
        throw new AppError(
          409,
          "Category name already exists"
        );
      }
    }

    return categoryRepository.update(id, data);
  },

  async deactivate(id: string) {
    await this.getById(id);
    return categoryRepository.deactivate(id);
  },
};

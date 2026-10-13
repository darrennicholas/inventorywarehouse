import { AppError } from "../../utils/AppError.ts";
import { customerRepository } from "./customer.repository.ts";

import type { CreateCustomerInput, ImportCustomersInput, UpdateCustomerInput } from "./customer.validation.ts";

export const customerService = {
  list() {
    return customerRepository.findAll();
  },

  async create(input: CreateCustomerInput) {
    const existing = await customerRepository.findByCode(
      input.code
    );

    if (existing) {
      throw new AppError(409, "Customer code already exists");
    }

    return customerRepository.create(input);
  },

  async getById(id: string) {
    const customer = await customerRepository.findById(id);
    if (!customer) throw new AppError(404, "Customer not found");
    return customer;
  },

  async update(id: string, input: UpdateCustomerInput) {
    await this.getById(id);
    if (input.code) {
      const existing = await customerRepository.findByCode(input.code);
      if (existing && existing.id !== id) throw new AppError(409, "Customer code already exists");
    }
    return customerRepository.update(id, input);
  },

  async deactivate(id: string) {
    await this.getById(id);
    return customerRepository.deactivate(id);
  },

  async importRows(input: ImportCustomersInput) {
    const uniqueByCode = [...new Map(input.rows.map((row) => [row.code, row])).values()];
    const result = await customerRepository.createMany(uniqueByCode);
    return { imported: result.count, skipped: input.rows.length - result.count };
  },
};

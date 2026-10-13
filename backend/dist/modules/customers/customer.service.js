import { AppError } from "../../utils/AppError.js";
import { customerRepository } from "./customer.repository.js";
export const customerService = {
    list() {
        return customerRepository.findAll();
    },
    async create(input) {
        const existing = await customerRepository.findByCode(input.code);
        if (existing) {
            throw new AppError(409, "Customer code already exists");
        }
        return customerRepository.create(input);
    },
    async getById(id) {
        const customer = await customerRepository.findById(id);
        if (!customer)
            throw new AppError(404, "Customer not found");
        return customer;
    },
    async update(id, input) {
        await this.getById(id);
        if (input.code) {
            const existing = await customerRepository.findByCode(input.code);
            if (existing && existing.id !== id)
                throw new AppError(409, "Customer code already exists");
        }
        return customerRepository.update(id, input);
    },
    async deactivate(id) {
        await this.getById(id);
        return customerRepository.deactivate(id);
    },
    async importRows(input) {
        const uniqueByCode = [...new Map(input.rows.map((row) => [row.code, row])).values()];
        const result = await customerRepository.createMany(uniqueByCode);
        return { imported: result.count, skipped: input.rows.length - result.count };
    },
};

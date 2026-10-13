import { AppError } from "../../utils/AppError.js";
import { productRepository } from "./product.repository.js";
// =====================================
// VERIFY CATEGORY / BRAND / UNIT
// =====================================
async function verifyReferences(data) {
    const results = await productRepository.validateRelations(data);
    if (!results[0]) {
        throw new AppError(422, "Category does not exist");
    }
    if (!results[1]) {
        throw new AppError(422, "Brand does not exist");
    }
    if (!results[2]) {
        throw new AppError(422, "Unit does not exist");
    }
}
// =====================================
// VERIFY UNIQUE SKU, CODE, BARCODE
// =====================================
async function verifyUnique(data, exceptId) {
    if (data.sku) {
        const found = await productRepository.findBySku(data.sku);
        if (found && found.id !== exceptId) {
            throw new AppError(409, "SKU already exists");
        }
    }
    if (data.code) {
        const found = await productRepository.findByCode(data.code);
        if (found && found.id !== exceptId) {
            throw new AppError(409, "Product code already exists");
        }
    }
    if (data.barcode) {
        const found = await productRepository.findByBarcode(data.barcode);
        if (found && found.id !== exceptId) {
            throw new AppError(409, "Barcode already exists");
        }
    }
    // PostgreSQL unique constraints also protect
    // against concurrent requests.
}
// =====================================
// PRODUCT SERVICE
// =====================================
export const productService = {
    // GET ALL
    list() {
        return productRepository.findAll();
    },
    // GET MASTER OPTIONS
    options() {
        return productRepository.getOptions();
    },
    // GET DETAIL
    async detail(id) {
        const product = await productRepository.findById(id);
        if (!product) {
            throw new AppError(404, "Product not found");
        }
        return product;
    },
    // CREATE PRODUCT
    async create(input) {
        await verifyReferences(input);
        await verifyUnique(input);
        return productRepository.create(input);
    },
    // UPDATE PRODUCT
    async update(id, input) {
        const current = await this.detail(id);
        // Prevent deactivating product with stock
        if (input.isActive === false &&
            typeof current.totalStock === "number" &&
            current.totalStock > 0) {
            throw new AppError(409, "Cannot deactivate a product while stock remains");
        }
        await verifyReferences(input);
        await verifyUnique(input, id);
        return productRepository.update(id, input);
    },
    // SOFT DELETE PRODUCT
    async deactivate(id) {
        const product = await this.detail(id);
        if (typeof product.totalStock === "number" &&
            product.totalStock > 0) {
            throw new AppError(409, "Cannot deactivate a product while stock remains");
        }
        return productRepository.update(id, {
            isActive: false,
        });
    },
};

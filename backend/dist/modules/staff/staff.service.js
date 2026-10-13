import { AppError } from "../../utils/AppError.js";
import { staffRepository } from "./staff.repository.js";
// ======================================
// NORMALIZE OPTIONAL TEXT
// ======================================
function normalizeText(value) {
    if (value === undefined) {
        return undefined;
    }
    const trimmed = value?.trim() ?? "";
    return trimmed || null;
}
// ======================================
// NORMALIZE STAFF DATA
// ======================================
function normalizeStaff(data) {
    return {
        ...data,
        ...(data.staffCode !== undefined
            ? {
                staffCode: data.staffCode
                    .trim()
                    .toUpperCase(),
            }
            : {}),
        ...(data.fullName !== undefined
            ? { fullName: data.fullName.trim() }
            : {}),
        ...(data.email !== undefined
            ? {
                email: normalizeText(data.email)
                    ?.toLowerCase() ?? null,
            }
            : {}),
        ...(data.phone !== undefined
            ? { phone: normalizeText(data.phone) }
            : {}),
        ...(data.position !== undefined
            ? { position: normalizeText(data.position) }
            : {}),
    };
}
// ======================================
// CHECK UNIQUE CODE AND EMAIL
// ======================================
async function verifyUnique(staffCode, email, exceptId) {
    if (staffCode !== undefined) {
        const sameCode = await staffRepository.findByCode(staffCode);
        if (sameCode && sameCode.id !== exceptId) {
            throw new AppError(409, "Staff code already exists");
        }
    }
    if (email) {
        const sameEmail = await staffRepository.findByEmail(email);
        if (sameEmail && sameEmail.id !== exceptId) {
            throw new AppError(409, "Email is already used by another staff member");
        }
    }
}
// ======================================
// VALIDATE ACTIVE WAREHOUSE
// ======================================
async function ensureActiveWarehouse(id) {
    const warehouse = await staffRepository.findWarehouse(id);
    if (!warehouse) {
        throw new AppError(404, "Selected warehouse was not found");
    }
    if (!warehouse.isActive) {
        throw new AppError(409, "Selected warehouse is inactive");
    }
}
// ======================================
// TRANSLATE PRISMA WRITE ERRORS
// ======================================
function translateWriteError(error) {
    if (error &&
        typeof error === "object" &&
        "code" in error) {
        const code = error.code;
        if (code === "P2002") {
            throw new AppError(409, "Staff code or email already exists");
        }
        if (code === "P2003") {
            throw new AppError(409, "Selected warehouse is invalid");
        }
        if (code === "P2025") {
            throw new AppError(404, "Staff not found");
        }
    }
    throw error;
}
// ======================================
// STAFF SERVICE
// ======================================
export const staffService = {
    // GET ALL STAFF
    list() {
        return staffRepository.findAll();
    },
    // GET STAFF DETAIL
    async detail(id) {
        const staff = await staffRepository.findById(id);
        if (!staff) {
            throw new AppError(404, "Staff not found");
        }
        return staff;
    },
    // CREATE STAFF
    async create(input) {
        const data = normalizeStaff(input);
        await verifyUnique(data.staffCode, data.email);
        if (data.warehouseId) {
            await ensureActiveWarehouse(data.warehouseId);
        }
        try {
            return await staffRepository.create(data);
        }
        catch (error) {
            return translateWriteError(error);
        }
    },
    // UPDATE STAFF
    async update(id, input) {
        const current = await staffService.detail(id);
        const data = normalizeStaff(input);
        await verifyUnique(data.staffCode, data.email, id);
        const reassigned = data.warehouseId !== undefined &&
            data.warehouseId !== current.warehouseId;
        const reactivating = data.isActive === true &&
            !current.isActive;
        if (reassigned || reactivating) {
            const assignedId = data.warehouseId !== undefined
                ? data.warehouseId
                : current.warehouseId;
            if (assignedId) {
                await ensureActiveWarehouse(assignedId);
            }
        }
        try {
            return await staffRepository.update(id, data);
        }
        catch (error) {
            return translateWriteError(error);
        }
    },
    // SOFT DELETE
    deactivate(id) {
        return staffService.update(id, {
            isActive: false,
        });
    },
};

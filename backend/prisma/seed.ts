import "dotenv/config";

import bcrypt from "bcryptjs";

import { prisma } from "../src/lib/prisma.ts";
import {
  PERMISSION_KEYS,
  ROLE_CODES,
  ROLE_NAMES,
  ROLE_PRESETS,
  type PermissionKey,
} from "../src/rbac/permissions.ts";

const date = (day: number) => new Date(`2026-10-${String(day).padStart(2, "0")}T08:00:00.000Z`);

type RoleCode = (typeof ROLE_CODES)[number];

async function seedAccess(adminEmail: string, adminPassword: string, demoPassword: string) {
  for (const key of PERMISSION_KEYS) {
    await prisma.permission.upsert({ where: { key }, update: {}, create: { key } });
  }

  const permissions = await prisma.permission.findMany({
    where: { key: { in: [...PERMISSION_KEYS] } },
    select: { id: true, key: true },
  });
  const permissionIds = new Map(permissions.map((permission) => [permission.key, permission.id]));

  for (const code of ROLE_CODES) {
    const ids = ROLE_PRESETS[code].map((key: PermissionKey) => {
      const id = permissionIds.get(key);
      if (!id) throw new Error(`Permission tidak ditemukan: ${key}`);
      return id;
    });

    await prisma.$transaction(async (tx) => {
      const role = await tx.role.upsert({
        where: { code },
        update: { name: ROLE_NAMES[code], isSystem: true, isActive: true },
        create: {
          code,
          name: ROLE_NAMES[code],
          description: `System role for ${ROLE_NAMES[code]}`,
          isSystem: true,
          isActive: true,
        },
      });
      await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
      await tx.rolePermission.createMany({ data: ids.map((permissionId) => ({ roleId: role.id, permissionId })) });
    });
  }

  const roles = await prisma.role.findMany({ where: { code: { in: [...ROLE_CODES] } } });
  const roleMap = new Map(roles.map((role) => [role.code as RoleCode, role.id]));

  const staffData = [
    { staffCode: "STF-ADM-001", fullName: "System Administrator", email: adminEmail, phone: "0812-0000-0001", position: "System Administrator", warehouseCode: "WH-JKT" },
    { staffCode: "STF-WHM-001", fullName: "Raka Pratama", email: process.env.WAREHOUSE_MANAGER_EMAIL?.trim().toLowerCase() ?? "warehouse.manager@stockflow.local", phone: "0812-0000-0002", position: "Warehouse Manager", warehouseCode: "WH-JKT" },
    { staffCode: "STF-WHS-001", fullName: "Siti Rahma", email: process.env.WAREHOUSE_STAFF_EMAIL?.trim().toLowerCase() ?? "warehouse.staff@stockflow.local", phone: "0812-0000-0003", position: "Warehouse Staff", warehouseCode: "WH-BDG" },
    { staffCode: "STF-PRC-001", fullName: "Dimas Saputra", email: process.env.PROCUREMENT_EMAIL?.trim().toLowerCase() ?? "procurement@stockflow.local", phone: "0812-0000-0004", position: "Procurement Officer", warehouseCode: "WH-JKT" },
    { staffCode: "STF-AUD-001", fullName: "Nadia Putri", email: process.env.AUDITOR_EMAIL?.trim().toLowerCase() ?? "auditor@stockflow.local", phone: "0812-0000-0005", position: "Inventory Auditor", warehouseCode: "WH-SBY" },
  ];

  const warehouses = await prisma.warehouse.findMany({ select: { id: true, code: true } });
  const warehouseMap = new Map(warehouses.map((warehouse) => [warehouse.code, warehouse.id]));
  const staffMap = new Map<string, string>();
  for (const staff of staffData) {
    const warehouseId = warehouseMap.get(staff.warehouseCode);
    if (!warehouseId) throw new Error(`Warehouse ${staff.warehouseCode} belum tersedia`);
    const record = await prisma.staff.upsert({
      where: { staffCode: staff.staffCode },
      update: { ...staff, warehouseCode: undefined, warehouseId, isActive: true },
      create: { ...staff, warehouseCode: undefined, warehouseId, isActive: true },
    });
    staffMap.set(staff.email, record.id);
  }

  const users: Array<{ email: string; fullName: string; roleCode: RoleCode }> = [
    { email: adminEmail, fullName: "System Administrator", roleCode: "ADMIN" },
    { email: process.env.WAREHOUSE_MANAGER_EMAIL?.trim().toLowerCase() ?? "warehouse.manager@stockflow.local", fullName: "Raka Pratama", roleCode: "WAREHOUSE_MANAGER" },
    { email: process.env.WAREHOUSE_STAFF_EMAIL?.trim().toLowerCase() ?? "warehouse.staff@stockflow.local", fullName: "Siti Rahma", roleCode: "WAREHOUSE_STAFF" },
    { email: process.env.PROCUREMENT_EMAIL?.trim().toLowerCase() ?? "procurement@stockflow.local", fullName: "Dimas Saputra", roleCode: "PROCUREMENT" },
    { email: process.env.AUDITOR_EMAIL?.trim().toLowerCase() ?? "auditor@stockflow.local", fullName: "Nadia Putri", roleCode: "AUDITOR" },
  ];

  const userMap = new Map<string, string>();
  for (const user of users) {
    const roleId = roleMap.get(user.roleCode);
    const staffId = staffMap.get(user.email);
    if (!roleId || !staffId) throw new Error(`Data akses tidak lengkap untuk ${user.email}`);
    const rolePassword = user.roleCode === "ADMIN"
      ? adminPassword
      : process.env[`${user.roleCode}_PASSWORD`] ?? demoPassword;
    if (rolePassword.length < 12) throw new Error(`${user.roleCode}_PASSWORD minimal 12 karakter.`);
    const rolePasswordHash = await bcrypt.hash(rolePassword, 12);
    const record = await prisma.user.upsert({
      where: { email: user.email },
      update: { fullName: user.fullName, roleId, staffId, passwordHash: rolePasswordHash, isActive: true },
      create: { email: user.email, fullName: user.fullName, roleId, staffId, passwordHash: rolePasswordHash, isActive: true },
    });
    userMap.set(user.email, record.id);
  }
  return { userMap };
}

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase() ?? "admin@stockflow.local";
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword || adminPassword.length < 12) {
    throw new Error("ADMIN_PASSWORD pada backend/.env wajib diisi minimal 12 karakter.");
  }
  const demoPassword = process.env.DEMO_PASSWORD ?? adminPassword;
  if (demoPassword.length < 12) throw new Error("DEMO_PASSWORD minimal 12 karakter.");

  console.log("StockFlow full demo seed dimulai...");

  const categoryData = [
    ["Electronics", "Perangkat elektronik dan komputer"],
    ["Accessories", "Aksesori komputer dan jaringan"],
    ["Office Supplies", "Kebutuhan operasional kantor"],
    ["Safety Equipment", "Perlengkapan keselamatan gudang"],
  ] as const;
  for (const [name, description] of categoryData) await prisma.category.upsert({ where: { name }, update: { description, isActive: true }, create: { name, description } });
  for (const name of ["Lenovo", "Logitech", "Epson", "Ugreen"])
    await prisma.brand.upsert({ where: { name }, update: { isActive: true }, create: { name } });
  for (const [code, name] of [["PCS", "Pieces"], ["BOX", "Box"], ["ROLL", "Roll"], ["SET", "Set"]] as const)
    await prisma.unit.upsert({ where: { code }, update: { name, isActive: true }, create: { code, name } });
  for (const warehouse of [
    { code: "WH-JKT", name: "Gudang Jakarta Pusat", address: "Jl. Gatot Subroto No. 18, Jakarta Selatan" },
    { code: "WH-BDG", name: "Gudang Bandung", address: "Jl. Asia Afrika No. 45, Bandung" },
    { code: "WH-SBY", name: "Gudang Surabaya", address: "Jl. Basuki Rahmat No. 90, Surabaya" },
  ]) await prisma.warehouse.upsert({ where: { code: warehouse.code }, update: { ...warehouse, isActive: true }, create: warehouse });
  for (const supplier of [
    { code: "SUP-001", name: "PT Teknologi Nusantara", email: "sales@teknologinusantara.test", phone: "021-555-1001", address: "Jakarta" },
    { code: "SUP-002", name: "CV Prima Office", email: "order@primaoffice.test", phone: "022-555-1002", address: "Bandung" },
    { code: "SUP-003", name: "PT Sumber Jaringan", email: "halo@sumberjaringan.test", phone: "031-555-1003", address: "Surabaya" },
    { code: "SUP-004", name: "UD Aman Sejahtera", email: "admin@amansejahtera.test", phone: "021-555-1004", address: "Tangerang" },
    { code: "SUP-005", name: "PT Solusi Perkantoran", email: "info@solusikantor.test", phone: "021-555-1005", address: "Bekasi" },
  ]) await prisma.supplier.upsert({ where: { code: supplier.code }, update: { ...supplier, isActive: true }, create: supplier });
  for (const customer of [
    { code: "CUS-001", name: "PT Cipta Digital", email: "purchasing@ciptadigital.test", phone: "021-444-2001", address: "Jakarta" },
    { code: "CUS-002", name: "CV Maju Bersama", email: "admin@majubersama.test", phone: "022-444-2002", address: "Bandung" },
    { code: "CUS-003", name: "Toko Komputer Jaya", email: "order@komputerjaya.test", phone: "031-444-2003", address: "Surabaya" },
    { code: "CUS-004", name: "PT Arunika Media", email: "finance@arunikamedia.test", phone: "021-444-2004", address: "Jakarta" },
    { code: "CUS-005", name: "Klinik Sehat Sentosa", email: "procurement@sehat.test", phone: "021-444-2005", address: "Depok" },
  ]) await prisma.customer.upsert({ where: { code: customer.code }, update: { ...customer, isActive: true }, create: customer });

  const categories = new Map((await prisma.category.findMany()).map((item) => [item.name, item.id]));
  const brands = new Map((await prisma.brand.findMany()).map((item) => [item.name, item.id]));
  const units = new Map((await prisma.unit.findMany()).map((item) => [item.code, item.id]));
  const productData = [
    { sku: "LP-LNV-T14", code: "PRD-001", barcode: "899100000001", name: "Lenovo ThinkPad T14", description: "Laptop bisnis 14 inci", minStock: 8, category: "Electronics", brand: "Lenovo", unit: "PCS" },
    { sku: "KB-LOG-K380", code: "PRD-002", barcode: "899100000002", name: "Logitech K380 Keyboard", description: "Keyboard Bluetooth ringkas", minStock: 20, category: "Accessories", brand: "Logitech", unit: "PCS" },
    { sku: "MS-LOG-M185", code: "PRD-003", barcode: "899100000003", name: "Logitech M185 Mouse", description: "Mouse wireless", minStock: 25, category: "Accessories", brand: "Logitech", unit: "PCS" },
    { sku: "PR-EPS-L3210", code: "PRD-004", barcode: "899100000004", name: "Epson L3210 Printer", description: "Printer ink tank", minStock: 5, category: "Electronics", brand: "Epson", unit: "PCS" },
    { sku: "CB-UGR-USBC", code: "PRD-005", barcode: "899100000005", name: "Ugreen USB-C Cable", description: "Kabel USB-C 1 meter", minStock: 30, category: "Accessories", brand: "Ugreen", unit: "PCS" },
    { sku: "HD-UGR-USBHUB", code: "PRD-006", barcode: "899100000006", name: "Ugreen USB Hub", description: "USB hub 4 port", minStock: 10, category: "Accessories", brand: "Ugreen", unit: "PCS" },
    { sku: "PP-A4-80", code: "PRD-007", barcode: "899100000007", name: "Kertas A4 80gsm", description: "Kertas fotokopi satu rim", minStock: 15, category: "Office Supplies", brand: "Epson", unit: "BOX" },
    { sku: "TN-EPS-003", code: "PRD-008", barcode: "899100000008", name: "Tinta Epson 003 Black", description: "Tinta hitam printer Epson", minStock: 12, category: "Office Supplies", brand: "Epson", unit: "PCS" },
    { sku: "GLV-SAFE-01", code: "PRD-009", barcode: "899100000009", name: "Safety Gloves", description: "Sarung tangan kerja gudang", minStock: 10, category: "Safety Equipment", brand: "Ugreen", unit: "SET" },
    { sku: "LBL-ROLL-01", code: "PRD-010", barcode: "899100000010", name: "Label Barcode Roll", description: "Label barcode thermal", minStock: 8, category: "Office Supplies", brand: "Logitech", unit: "ROLL" },
  ];
  for (const product of productData) {
    await prisma.product.upsert({
      where: { sku: product.sku },
      update: { ...product, category: undefined, brand: undefined, unit: undefined, categoryId: categories.get(product.category), brandId: brands.get(product.brand), unitId: units.get(product.unit), isActive: true },
      create: { ...product, category: undefined, brand: undefined, unit: undefined, categoryId: categories.get(product.category), brandId: brands.get(product.brand), unitId: units.get(product.unit) },
    });
  }

  const warehouseList = await prisma.warehouse.findMany({ select: { id: true, code: true } });
  const warehouseMap = new Map(warehouseList.map((item) => [item.code, item.id]));
  const locationByCode = new Map<string, string>();
  for (const location of [
    { warehouseCode: "WH-JKT", code: "JKT-A01", name: "Jakarta Aisle 01", zone: "A", rack: "01", shelf: "01", bin: "01" },
    { warehouseCode: "WH-JKT", code: "JKT-B01", name: "Jakarta Aisle 02", zone: "B", rack: "01", shelf: "01", bin: "01" },
    { warehouseCode: "WH-BDG", code: "BDG-A01", name: "Bandung Aisle 01", zone: "A", rack: "01", shelf: "01", bin: "01" },
    { warehouseCode: "WH-SBY", code: "SBY-A01", name: "Surabaya Aisle 01", zone: "A", rack: "01", shelf: "01", bin: "01" },
  ]) {
    const warehouseId = warehouseMap.get(location.warehouseCode);
    if (!warehouseId) throw new Error(`Warehouse ${location.warehouseCode} belum tersedia`);
    const record = await prisma.warehouseLocation.upsert({ where: { warehouseId_code: { warehouseId, code: location.code } }, update: { ...location, warehouseCode: undefined, warehouseId, isActive: true }, create: { ...location, warehouseCode: undefined, warehouseId } });
    locationByCode.set(location.code, record.id);
  }
  await prisma.product.update({ where: { sku: "CB-UGR-USBC" }, data: { trackBatch: true } });
  const { userMap } = await seedAccess(adminEmail, adminPassword, demoPassword);
  const products = await prisma.product.findMany({ select: { id: true, sku: true, trackBatch: true } });
  const productMap = new Map(products.map((item) => [item.sku, item.id]));
  const supplierMap = new Map((await prisma.supplier.findMany({ select: { id: true, code: true } })).map((item) => [item.code, item.id]));
  const customerMap = new Map((await prisma.customer.findMany({ select: { id: true, code: true } })).map((item) => [item.code, item.id]));
  const id = (map: Map<string, string>, key: string) => {
    const value = map.get(key);
    if (!value) throw new Error(`Seed reference tidak ditemukan: ${key}`);
    return value;
  };
  const jkt = id(warehouseMap, "WH-JKT"), bdg = id(warehouseMap, "WH-BDG"), sby = id(warehouseMap, "WH-SBY");
  const procurement = id(userMap, "procurement@stockflow.local"), manager = id(userMap, "warehouse.manager@stockflow.local"), staff = id(userMap, "warehouse.staff@stockflow.local"), admin = id(userMap, adminEmail);

  await prisma.payment.deleteMany({ where: { number: { startsWith: "SEED-" } } });
  await prisma.goodsReceipt.deleteMany({ where: { number: { startsWith: "SEED-" } } });
  await prisma.stockMovement.deleteMany({ where: { note: { startsWith: "Seed:" } } });
  await prisma.purchaseOrder.deleteMany({ where: { number: { startsWith: "SEED-" } } });
  await prisma.sale.deleteMany({ where: { number: { startsWith: "SEED-" } } });
  await prisma.stockAdjustment.deleteMany({ where: { number: { startsWith: "SEED-" } } });
  await prisma.stockTransfer.deleteMany({ where: { number: { startsWith: "SEED-" } } });
  await prisma.expense.deleteMany({ where: { number: { startsWith: "SEED-" } } });

  const poReceived = await prisma.purchaseOrder.create({ data: {
    number: "SEED-PO-202610-001", supplierId: id(supplierMap, "SUP-001"), warehouseId: jkt, createdById: procurement, approvedById: manager, approvedAt: date(3), status: "RECEIVED", orderDate: date(2), expectedDate: date(5), notes: "Penerimaan perangkat untuk stok demo", subtotal: 336500000, tax: 37015000, total: 373515000,
    items: { create: [
      { productId: id(productMap, "LP-LNV-T14"), quantity: 20, receivedQuantity: 20, unitPrice: 14000000, total: 280000000 },
      { productId: id(productMap, "KB-LOG-K380"), quantity: 50, receivedQuantity: 50, unitPrice: 450000, total: 22500000 },
      { productId: id(productMap, "MS-LOG-M185"), quantity: 80, receivedQuantity: 80, unitPrice: 150000, total: 12000000 },
      { productId: id(productMap, "PR-EPS-L3210"), quantity: 12, receivedQuantity: 12, unitPrice: 1500000, total: 18000000 },
      { productId: id(productMap, "CB-UGR-USBC"), quantity: 100, receivedQuantity: 100, unitPrice: 40000, total: 4000000 },
    ] },
  } });
  const poPending = await prisma.purchaseOrder.create({ data: {
    number: "SEED-PO-202610-002", supplierId: id(supplierMap, "SUP-002"), warehouseId: bdg, createdById: procurement, status: "PENDING", orderDate: date(10), expectedDate: date(18), notes: "Menunggu persetujuan pembelian perlengkapan kantor", subtotal: 9250000, tax: 1017500, total: 10267500,
    items: { create: [
      { productId: id(productMap, "PP-A4-80"), quantity: 50, receivedQuantity: 0, unitPrice: 65000, total: 3250000 },
      { productId: id(productMap, "TN-EPS-003"), quantity: 30, receivedQuantity: 0, unitPrice: 150000, total: 4500000 },
      { productId: id(productMap, "LBL-ROLL-01"), quantity: 10, receivedQuantity: 0, unitPrice: 150000, total: 1500000 },
    ] },
  } });
  const saleCompleted = await prisma.sale.create({ data: {
    number: "SEED-SALE-202610-001", customerId: id(customerMap, "CUS-001"), warehouseId: jkt, createdById: staff, status: "COMPLETED", saleDate: date(6), notes: "Pengiriman pesanan kantor pusat", subtotal: 59950000, discount: 950000, tax: 6480000, total: 65480000,
    items: { create: [
      { productId: id(productMap, "LP-LNV-T14"), quantity: 3, unitPrice: 17000000, total: 51000000 },
      { productId: id(productMap, "KB-LOG-K380"), quantity: 8, unitPrice: 650000, total: 5200000 },
      { productId: id(productMap, "MS-LOG-M185"), quantity: 15, unitPrice: 250000, total: 3750000 },
    ] },
  } });
  await prisma.sale.create({ data: {
    number: "SEED-SALE-202610-002", customerId: id(customerMap, "CUS-003"), warehouseId: bdg, createdById: staff, status: "DRAFT", saleDate: date(12), notes: "Draft penawaran pelanggan", subtotal: 3300000, discount: 0, tax: 363000, total: 3663000,
    items: { create: [{ productId: id(productMap, "LP-LNV-T14"), quantity: 1, unitPrice: 16500000, total: 16500000 }, { productId: id(productMap, "KB-LOG-K380"), quantity: 3, unitPrice: 650000, total: 1950000 }] },
  } });
  const adjustment = await prisma.stockAdjustment.create({ data: {
    number: "SEED-ADJ-202610-001", warehouseId: jkt, createdById: staff, approvedById: manager, approvedAt: date(7), type: "INCREASE", status: "POSTED", reason: "Stok fisik printer ditemukan lebih 2 unit saat stock opname", adjustmentDate: date(7),
    items: { create: [{ productId: id(productMap, "PR-EPS-L3210"), quantity: 2, notes: "Verifikasi stock opname Oktober" }] },
  } });
  await prisma.stockAdjustment.create({ data: {
    number: "SEED-ADJ-202610-002", warehouseId: sby, createdById: manager, type: "DECREASE", status: "DRAFT", reason: "Barang rusak menunggu konfirmasi", adjustmentDate: date(11),
    items: { create: [{ productId: id(productMap, "GLV-SAFE-01"), quantity: 2, notes: "Belum diposting" }] },
  } });
  const transfer = await prisma.stockTransfer.create({ data: {
    number: "SEED-TRF-202610-001", fromWarehouseId: jkt, toWarehouseId: bdg, createdById: staff, approvedById: manager, approvedAt: date(8), status: "COMPLETED", transferDate: date(8), notes: "Replenishment gudang Bandung",
    items: { create: [{ productId: id(productMap, "LP-LNV-T14"), quantity: 4 }, { productId: id(productMap, "KB-LOG-K380"), quantity: 10 }] },
  } });
  await prisma.stockTransfer.create({ data: {
    number: "SEED-TRF-202610-002", fromWarehouseId: jkt, toWarehouseId: sby, createdById: manager, status: "IN_TRANSIT", transferDate: date(12), notes: "Pengiriman aksesori ke Surabaya",
    items: { create: [{ productId: id(productMap, "MS-LOG-M185"), quantity: 10 }] },
  } });
  const expenses = await Promise.all([
    prisma.expense.create({ data: { number: "SEED-EXP-202610-001", category: "Freight", description: "Ongkos kirim penerimaan PO Oktober", amount: 1250000, warehouseId: jkt, createdById: procurement, expenseDate: date(5), isPaid: true } }),
    prisma.expense.create({ data: { number: "SEED-EXP-202610-002", category: "Maintenance", description: "Perawatan forklift gudang", amount: 850000, warehouseId: bdg, createdById: manager, expenseDate: date(9), isPaid: true } }),
    prisma.expense.create({ data: { number: "SEED-EXP-202610-003", category: "Utilities", description: "Listrik area penyimpanan", amount: 2100000, warehouseId: sby, createdById: admin, expenseDate: date(10), isPaid: false } }),
  ]);

  const quantities: Record<string, number> = { "LP-LNV-T14:WH-JKT": 13, "LP-LNV-T14:WH-BDG": 4, "KB-LOG-K380:WH-JKT": 32, "KB-LOG-K380:WH-BDG": 10, "MS-LOG-M185:WH-JKT": 65, "PR-EPS-L3210:WH-JKT": 14, "CB-UGR-USBC:WH-JKT": 100 };
  const balanceMap = new Map<string, string>();
  for (const product of products) for (const warehouse of warehouseList) {
    const key = `${product.sku}:${warehouse.code}`;
    const balance = await prisma.inventoryBalance.upsert({
      where: { productId_warehouseId: { productId: product.id, warehouseId: warehouse.id } },
      update: { quantityOnHand: quantities[key] ?? 0, reservedQuantity: 0, locationId: warehouse.code === "WH-JKT" ? locationByCode.get("JKT-A01") : warehouse.code === "WH-BDG" ? locationByCode.get("BDG-A01") : locationByCode.get("SBY-A01") },
      create: { productId: product.id, warehouseId: warehouse.id, quantityOnHand: quantities[key] ?? 0, locationId: warehouse.code === "WH-JKT" ? locationByCode.get("JKT-A01") : warehouse.code === "WH-BDG" ? locationByCode.get("BDG-A01") : locationByCode.get("SBY-A01") },
    });
    balanceMap.set(key, balance.id);
  }
  const balance = (sku: string, code: string) => id(balanceMap, `${sku}:${code}`);
  await prisma.productBatch.upsert({ where: { productId_warehouseId_batchNumber: { productId: id(productMap, "CB-UGR-USBC"), warehouseId: jkt, batchNumber: "LOT-CB-2610-A" } }, update: { quantityOnHand: 60, reservedQuantity: 0, expiryDate: new Date("2026-11-15T00:00:00.000Z"), locationId: locationByCode.get("JKT-A01"), status: "ACTIVE" }, create: { productId: id(productMap, "CB-UGR-USBC"), warehouseId: jkt, batchNumber: "LOT-CB-2610-A", quantityOnHand: 60, expiryDate: new Date("2026-11-15T00:00:00.000Z"), locationId: locationByCode.get("JKT-A01") } });
  await prisma.productBatch.upsert({ where: { productId_warehouseId_batchNumber: { productId: id(productMap, "CB-UGR-USBC"), warehouseId: jkt, batchNumber: "LOT-CB-2610-B" } }, update: { quantityOnHand: 40, reservedQuantity: 0, expiryDate: new Date("2027-01-15T00:00:00.000Z"), locationId: locationByCode.get("JKT-B01"), status: "ACTIVE" }, create: { productId: id(productMap, "CB-UGR-USBC"), warehouseId: jkt, batchNumber: "LOT-CB-2610-B", quantityOnHand: 40, expiryDate: new Date("2027-01-15T00:00:00.000Z"), locationId: locationByCode.get("JKT-B01") } });
  const receivedPurchaseItems = await prisma.purchaseOrderItem.findMany({ where: { purchaseOrderId: poReceived.id } });
  const seededCableBatch = await prisma.productBatch.findUnique({ where: { productId_warehouseId_batchNumber: { productId: id(productMap, "CB-UGR-USBC"), warehouseId: jkt, batchNumber: "LOT-CB-2610-A" } } });
  await prisma.goodsReceipt.create({ data: { number: "SEED-GR-202610-001", purchaseOrderId: poReceived.id, warehouseId: jkt, receivedById: procurement, receivedAt: date(5), notes: "Seed goods receipt", items: { create: receivedPurchaseItems.map((item) => ({ purchaseOrderItemId: item.id, productId: item.productId, locationId: locationByCode.get("JKT-A01")!, batchId: item.productId === id(productMap, "CB-UGR-USBC") ? seededCableBatch?.id ?? null : null, quantity: item.quantity, damagedQuantity: 0 })) } } });
  for (const product of products) for (const warehouse of warehouseList) {
    const fallbackLocationId = warehouse.code === "WH-JKT" ? locationByCode.get("JKT-A01")! : warehouse.code === "WH-BDG" ? locationByCode.get("BDG-A01")! : locationByCode.get("SBY-A01")!;
    const batches = product.trackBatch ? await prisma.productBatch.findMany({ where: { productId: product.id, warehouseId: warehouse.id } }) : [];
    const rows = batches.length
      ? batches.map((batch) => ({ locationId: batch.locationId ?? fallbackLocationId, batchId: batch.id, quantityOnHand: batch.quantityOnHand, reservedQuantity: batch.reservedQuantity }))
      : [{ locationId: fallbackLocationId, batchId: null, quantityOnHand: quantities[`${product.sku}:${warehouse.code}`] ?? 0, reservedQuantity: 0 }];
    for (const row of rows) {
      const existing = await prisma.inventoryLocationBalance.findFirst({ where: { productId: product.id, warehouseId: warehouse.id, locationId: row.locationId, batchId: row.batchId } });
      if (existing) await prisma.inventoryLocationBalance.update({ where: { id: existing.id }, data: { quantityOnHand: row.quantityOnHand, reservedQuantity: row.reservedQuantity } });
      else await prisma.inventoryLocationBalance.create({ data: { productId: product.id, warehouseId: warehouse.id, locationId: row.locationId, batchId: row.batchId, quantityOnHand: row.quantityOnHand, reservedQuantity: row.reservedQuantity } });
    }
  }
  await prisma.stockMovement.createMany({ data: [
    { productId: id(productMap, "LP-LNV-T14"), warehouseId: jkt, inventoryBalanceId: balance("LP-LNV-T14", "WH-JKT"), quantity: 20, movementType: "PURCHASE_RECEIPT", unitCost: 14000000, purchaseOrderId: poReceived.id, createdById: procurement, occurredAt: date(5), note: "Seed: penerimaan PO perangkat" },
    { productId: id(productMap, "KB-LOG-K380"), warehouseId: jkt, inventoryBalanceId: balance("KB-LOG-K380", "WH-JKT"), quantity: 50, movementType: "PURCHASE_RECEIPT", unitCost: 450000, purchaseOrderId: poReceived.id, createdById: procurement, occurredAt: date(5), note: "Seed: penerimaan PO perangkat" },
    { productId: id(productMap, "MS-LOG-M185"), warehouseId: jkt, inventoryBalanceId: balance("MS-LOG-M185", "WH-JKT"), quantity: 80, movementType: "PURCHASE_RECEIPT", unitCost: 150000, purchaseOrderId: poReceived.id, createdById: procurement, occurredAt: date(5), note: "Seed: penerimaan PO perangkat" },
    { productId: id(productMap, "PR-EPS-L3210"), warehouseId: jkt, inventoryBalanceId: balance("PR-EPS-L3210", "WH-JKT"), quantity: 12, movementType: "PURCHASE_RECEIPT", unitCost: 1500000, purchaseOrderId: poReceived.id, createdById: procurement, occurredAt: date(5), note: "Seed: penerimaan PO perangkat" },
    { productId: id(productMap, "CB-UGR-USBC"), warehouseId: jkt, inventoryBalanceId: balance("CB-UGR-USBC", "WH-JKT"), quantity: 100, movementType: "PURCHASE_RECEIPT", unitCost: 40000, purchaseOrderId: poReceived.id, createdById: procurement, occurredAt: date(5), note: "Seed: penerimaan PO perangkat" },
    { productId: id(productMap, "LP-LNV-T14"), warehouseId: jkt, inventoryBalanceId: balance("LP-LNV-T14", "WH-JKT"), quantity: -3, movementType: "SALE_ISSUE", saleId: saleCompleted.id, createdById: staff, occurredAt: date(6), note: "Seed: pengiriman penjualan" },
    { productId: id(productMap, "KB-LOG-K380"), warehouseId: jkt, inventoryBalanceId: balance("KB-LOG-K380", "WH-JKT"), quantity: -8, movementType: "SALE_ISSUE", saleId: saleCompleted.id, createdById: staff, occurredAt: date(6), note: "Seed: pengiriman penjualan" },
    { productId: id(productMap, "MS-LOG-M185"), warehouseId: jkt, inventoryBalanceId: balance("MS-LOG-M185", "WH-JKT"), quantity: -15, movementType: "SALE_ISSUE", saleId: saleCompleted.id, createdById: staff, occurredAt: date(6), note: "Seed: pengiriman penjualan" },
    { productId: id(productMap, "PR-EPS-L3210"), warehouseId: jkt, inventoryBalanceId: balance("PR-EPS-L3210", "WH-JKT"), quantity: 2, movementType: "ADJUSTMENT_IN", adjustmentId: adjustment.id, createdById: manager, occurredAt: date(7), note: "Seed: hasil stock opname" },
    { productId: id(productMap, "LP-LNV-T14"), warehouseId: jkt, inventoryBalanceId: balance("LP-LNV-T14", "WH-JKT"), quantity: -4, movementType: "TRANSFER_OUT", transferId: transfer.id, createdById: manager, occurredAt: date(8), note: "Seed: transfer ke Bandung" },
    { productId: id(productMap, "LP-LNV-T14"), warehouseId: bdg, inventoryBalanceId: balance("LP-LNV-T14", "WH-BDG"), quantity: 4, movementType: "TRANSFER_IN", transferId: transfer.id, createdById: manager, occurredAt: date(8), note: "Seed: transfer dari Jakarta" },
    { productId: id(productMap, "KB-LOG-K380"), warehouseId: jkt, inventoryBalanceId: balance("KB-LOG-K380", "WH-JKT"), quantity: -10, movementType: "TRANSFER_OUT", transferId: transfer.id, createdById: manager, occurredAt: date(8), note: "Seed: transfer ke Bandung" },
    { productId: id(productMap, "KB-LOG-K380"), warehouseId: bdg, inventoryBalanceId: balance("KB-LOG-K380", "WH-BDG"), quantity: 10, movementType: "TRANSFER_IN", transferId: transfer.id, createdById: manager, occurredAt: date(8), note: "Seed: transfer dari Jakarta" },
  ] });
  await prisma.payment.createMany({ data: [
    { number: "SEED-PAY-202610-001", type: "PURCHASE", purchaseOrderId: poReceived.id, paidById: procurement, amount: 373515000, method: "BANK_TRANSFER", status: "PAID", paymentDate: date(6), referenceNo: "BT-20261006-001", notes: "Pelunasan PO perangkat" },
    { number: "SEED-PAY-202610-002", type: "SALE", saleId: saleCompleted.id, paidById: staff, amount: 65480000, method: "BANK_TRANSFER", status: "PAID", paymentDate: date(7), referenceNo: "INV-CUS-001-10", notes: "Pembayaran pelanggan" },
    { number: "SEED-PAY-202610-003", type: "EXPENSE", expenseId: expenses[0].id, paidById: procurement, amount: 1250000, method: "CASH", status: "PAID", paymentDate: date(5), referenceNo: "CASH-EXP-001", notes: "Pembayaran biaya pengiriman" },
    { number: "SEED-PAY-202610-004", type: "PURCHASE", purchaseOrderId: poPending.id, paidById: procurement, amount: 0, method: "BANK_TRANSFER", status: "PENDING", paymentDate: date(10), referenceNo: "PENDING-PO-002", notes: "Menunggu approval" },
  ] });

  const [roleCount, userCount, productCount, balanceCount, movementCount] = await Promise.all([
    prisma.role.count(), prisma.user.count(), prisma.product.count(), prisma.inventoryBalance.count(), prisma.stockMovement.count(),
  ]);
  console.log(`Seed selesai: ${roleCount} role, ${userCount} user, ${productCount} produk, ${balanceCount} saldo stok, ${movementCount} mutasi.`);
}

main()
  .catch((error: unknown) => { console.error("Full seed gagal:", error); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });

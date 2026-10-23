# StockFlow — Inventory & Warehouse Management

StockFlow adalah aplikasi full-stack untuk mengelola master produk, gudang, stok, pembelian, penjualan, penyesuaian stok, transfer antar-gudang, biaya, pembayaran, laporan stok, dan akses pengguna berbasis peran.

## Teknologi

- Frontend: Next.js + TypeScript
- Backend: Express + TypeScript
- Database: PostgreSQL + Prisma ORM
- Authentication: session cookie dan role-based permission (RBAC)

## Fitur utama

- Dashboard analitik dengan pie chart, bar chart, line chart, dan progress stock level.
- Dashboard operasional dengan nilai purchase, sales, expense, stok aktif, dan reorder queue.
- Master data: category, brand, unit, product, warehouse, staff, supplier, dan customer.
- Operasional: purchase, sale, stock adjustment, stock transfer, expense, dan payment.
- Stock report berbasis `InventoryBalance` dan audit trail berbasis `StockMovement`.
- Perlindungan stok atomik untuk mencegah saldo negatif saat transaksi bersamaan.
- Approval workflow untuk purchase, adjustment, dan transfer dengan permission khusus.
- Upload/import customer CSV dan unduh template PDF warehouse.
- Mode terang/gelap serta akses yang dibatasi menurut permission pengguna.
- Database constraints untuk mencegah stok/reservasi negatif, rentang stok tidak valid, lokasi relokasi sama, dan approval matrix yang tumpang tindih.
- Penyimpanan attachment configurable dan persistent dengan pemeriksaan ukuran, MIME signature, nama storage acak, serta download berbasis permission.
- Server-side pagination pada transaksi, master data, return, fulfillment, audit, notification, attachment, stock report, dan drill-down inventory analytics.

## Prasyarat

- Node.js 20 atau lebih baru
- PostgreSQL 15 atau lebih baru (Laragon dapat digunakan di Windows)
- npm

## Konfigurasi environment

Salin template environment yang aman lalu sesuaikan nilai koneksi database dan password sebelum menjalankan aplikasi.

```powershell
Copy-Item backend/.env.example backend/.env
Copy-Item frontend/.env.example frontend/.env.local
```

Isi `backend/.env` seperti contoh berikut:

```env
NODE_ENV=development
PORT=5000
DATABASE_URL="postgresql://postgres:password@localhost:5432/inventorywarehouse?schema=public"
FRONTEND_URL=http://localhost:3000
SESSION_SECRET=ganti-dengan-random-string-yang-panjang-dan-aman

# Dipakai oleh seeder. Semua password minimal 12 karakter.
ADMIN_EMAIL=admin@stockflow.local
ADMIN_PASSWORD=ChangeThisAdmin123!
WAREHOUSE_MANAGER_EMAIL=warehouse.manager@stockflow.local
WAREHOUSE_MANAGER_PASSWORD=ChangeThisManager123!
WAREHOUSE_STAFF_EMAIL=warehouse.staff@stockflow.local
WAREHOUSE_STAFF_PASSWORD=ChangeThisStaff123!
PROCUREMENT_EMAIL=procurement@stockflow.local
PROCUREMENT_PASSWORD=ChangeThisProcurement123!
AUDITOR_EMAIL=auditor@stockflow.local
AUDITOR_PASSWORD=ChangeThisAuditor123!
DEMO_PASSWORD=ChangeThisDemoPassword123!

# Simpan attachment di direktori persistent di luar repository pada production.
ATTACHMENT_STORAGE_PATH=C:/stockflow-data/attachments
ATTACHMENT_MAX_BYTES=10485760
```

Untuk frontend, bila URL API perlu diubah, buat `frontend/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:5000
```

## Instalasi dan menjalankan aplikasi

Jalankan perintah berikut dari root repository.

```powershell
cd backend
npm install
npx prisma generate
npx prisma migrate deploy
npm run seed
npm run dev
```

Pada terminal lain:

```powershell
cd frontend
npm install
npm run dev
```

Buka `http://localhost:3000` di browser. Backend berjalan pada `http://localhost:5000`.

Untuk lingkungan development baru yang belum memiliki migration history, gunakan `npx prisma migrate dev` sebagai pengganti `npx prisma migrate deploy`.

## Data demo dan akun login

`npm run seed` mengisi seluruh master data dan transaksi demo. `npm run seed:access` mengisi permission, role, email, dan password untuk kelima akun sesuai variabel role di `backend/.env`.

| Role | Email | Password demo | Cakupan akses |
| --- | --- | --- | --- |
| Administrator | `admin@stockflow.local` | `admindeveloper` | Seluruh menu, user, role, dan pengaturan master data |
| Warehouse Manager | `warehouse.manager@stockflow.local` | `warehousemanager123!` | Gudang, stok, adjustment, transfer, dan laporan |
| Warehouse Staff | `warehouse.staff@stockflow.local` | `warehousestaff123!` | Operasional stok dan transfer sesuai permission |
| Procurement | `procurement@stockflow.local` | `procurement123!` | Supplier, purchase, biaya, pembayaran, dan laporan |
| Auditor | `auditor@stockflow.local` | `auditor123456!` | Akses baca untuk audit dan laporan |

> Password di atas adalah kredensial development lokal dari `backend/.env`. Jangan gunakan password demo ini untuk production dan jangan commit file `backend/.env`; Git hanya menyimpan `backend/.env.example`.

Seeder membuat data siap pakai untuk setiap menu:

- 4 category, 4 brand, 4 unit, dan 10 product
- 3 warehouse, 5 supplier, 5 customer, dan 5 staff
- 5 user dengan 5 role berbeda dan permission role masing-masing
- Purchase order diterima dan pending, sale selesai dan draft
- Stock adjustment posted/draft, transfer completed/in-transit
- Expense, payment, saldo stok, serta stock movement sebagai audit trail

Seeder bersifat idempoten. Menjalankannya kembali memperbarui master/demo account dan hanya menghapus transaksi demo dengan nomor berawalan `SEED-` serta movement dengan catatan `Seed:`. Data operasional lain tidak dihapus.

### Matriks menu dan action per role

Permission memakai pola `menu.action`: `read` untuk melihat, `write` untuk menambah/mengubah, `delete` untuk menonaktifkan/membatalkan, dan `approve` untuk persetujuan workflow.

| Menu/domain | Administrator | Warehouse Manager | Warehouse Staff | Procurement | Auditor |
| --- | --- | --- | --- | --- | --- |
| Dashboard | lihat | lihat | lihat | lihat | lihat |
| Categories, Brands, Units | lihat/tambah/ubah/hapus | lihat | lihat | — | lihat |
| Products | lihat/tambah/ubah/hapus | lihat | lihat | lihat | lihat |
| Warehouse | lihat/tambah/ubah/hapus | lihat/tambah/ubah/hapus | lihat | lihat | lihat |
| Staff | lihat/tambah/ubah/hapus | lihat | — | — | lihat |
| Customer | lihat/tambah/ubah/hapus | — | — | — | lihat |
| Supplier | lihat/tambah/ubah/hapus | — | — | lihat/tambah/ubah/hapus | lihat |
| Purchase | lihat/tambah/ubah/hapus/setujui | lihat/setujui | lihat | lihat/tambah/ubah/hapus/setujui | lihat |
| Sale | lihat/tambah/ubah/hapus | lihat | lihat | — | lihat |
| Adjustment | lihat/tambah/ubah/hapus/setujui | lihat/tambah/ubah/hapus/setujui | — | — | lihat |
| Transfer | lihat/tambah/ubah/hapus/setujui | lihat/tambah/ubah/hapus/setujui | lihat/tambah/ubah | — | lihat |
| Expense & Payment | lihat/tambah/ubah/hapus | lihat | — | lihat | lihat |
| Stock Report | lihat | lihat | — | lihat | lihat |
| Stock Opname | lihat/tambah/ubah/setujui | lihat/tambah/ubah/setujui | lihat/tambah/ubah | lihat/tambah/ubah | lihat |
| Audit Log | lihat | lihat | — | — | lihat |
| User & Role Management | kelola | — | — | — | — |

Mapping tersebut berasal dari `ROLE_PRESETS` di `backend/src/rbac/permissions.ts` dan otomatis dimasukkan ke tabel `Permission` serta `RolePermission` oleh `npm run seed:access`. Seeder juga mencetak permission matrix ke terminal setiap kali dijalankan.

### Approval workflow

- Purchase harus berstatus `PENDING`, kemudian disetujui menjadi `APPROVED`, baru dapat diterima menjadi `RECEIVED`.
- Adjustment dibuat sebagai `DRAFT`, lalu disetujui menjadi `POSTED`; perubahan stok dan stock movement dibuat pada saat approval.
- Transfer dibuat sebagai `DRAFT`, lalu disetujui menjadi `IN_TRANSIT`, dan dapat diselesaikan menjadi `COMPLETED`.
- Approval menyimpan user dan waktu approval pada transaksi.

## Perintah yang tersedia

| Lokasi | Perintah | Kegunaan |
| --- | --- | --- |
| `backend` | `npm run dev` | Menjalankan API dalam mode development |
| `backend` | `npm run build` | Build TypeScript backend |
| `backend` | `npm run typecheck` | Validasi tipe TypeScript |
| `backend` | `npm run seed` | Seed lengkap seluruh aplikasi dan lima role demo |
| `backend` | `npm run seed:access` | Seed permission, role, dan akun akses saja |
| `backend` | `npm test` | Unit test permission; integration test dilewati secara default |
| `backend` | `npm run test:integration` | Test concurrency dan rollback PostgreSQL |
| `backend` | `npm run db:backup` | Membuat backup PostgreSQL format custom di `backend/backups` |
| `frontend` | `npm run dev` | Menjalankan UI Next.js |
| `frontend` | `npm run build` | Build production frontend |
| `frontend` | `npm run lint` | Lint frontend |

## Alur data utama

```text
Product + Warehouse
        │
        ├── InventoryBalance (stok terkini)
        └── StockMovement (audit mutasi)
              ├── Purchase receipt
              ├── Sale issue
              ├── Adjustment in/out
              └── Transfer in/out
```

Gunakan `npx prisma studio` dari folder `backend` bila ingin memeriksa data database secara visual.

## Testing dan system hardening

Jalankan `npm test` untuk permission test tanpa mengubah database. Untuk menjalankan concurrency test dan rollback test terhadap database lokal, pastikan database sudah di-migrate dan di-seed, lalu jalankan `npm run test:integration`. Test integrasi membuat data sementara dengan prefix `TEST-` dan membersihkannya kembali.

Backup manual dapat dibuat dengan `npm run db:backup`. File backup sengaja diabaikan Git melalui `backend/backups/`; simpan salinan backup di lokasi terpisah atau object storage. Script membutuhkan executable `pg_dump` dari instalasi PostgreSQL. API juga mengeluarkan JSON structured error log dan `X-Request-Id` agar error mudah dicari di log collector.

> Jangan gunakan `npx prisma migrate reset` pada database yang berisi data penting karena perintah tersebut menghapus seluruh isi database.

## Storage attachment production

Attachment tidak disimpan di folder source yang akan di-push ke GitHub. Backend membaca lokasi dari `ATTACHMENT_STORAGE_PATH`; pada production gunakan volume persistent atau direktori khusus di luar repository. API menerima PDF, CSV, PNG, JPG, dan WEBP sampai batas `ATTACHMENT_MAX_BYTES`, memverifikasi signature isi file, membuat storage key acak, dan tetap memeriksa permission dokumen ketika list, download, upload, atau delete.

Folder runtime berikut sengaja diabaikan Git: `backend/storage/`, `backend/uploads/`, `backend/backups/`, `backend/dist/`, `frontend/.next/`, coverage, log, dump PostgreSQL, serta seluruh file `.env` selain `.env.example`.

## Pagination API

Endpoint list menerima `page` dan `pageSize` dengan batas maksimal 100. Bentuk respons tetap kompatibel:

```json
{
  "success": true,
  "data": [],
  "meta": { "page": 1, "pageSize": 50, "total": 0, "totalPages": 0 }
}
```

Endpoint inventory analytics juga mengembalikan `meta` untuk daftar `products`, sedangkan KPI, aging, reorder, dan dead-stock tetap tersedia sebagai ringkasan.

## Struktur route backend

`modules/operations/operations.routes.ts` sekarang menjadi entry point router yang kecil. Domain finance dipisahkan ke `finance.routes.ts`, sementara route transaksi lama berada di `transaction.routes.ts` agar URL `/api/operations/*` tetap kompatibel selama modularisasi lanjutan.

Migration `20261023090000_add_inventory_constraints` menambahkan constraint database dan trigger pencegah approval policy overlap. Setelah menarik perubahan terbaru jalankan:

```powershell
cd backend
npx prisma migrate deploy
npx prisma generate
```

## Step 6–9: audit, stock opname, UI/UX, dan refactoring

- `AuditLog` menyimpan actor, action, entity, before/after JSON, request ID, IP, dan user-agent. Ini terpisah dari `StockMovement`, sehingga perubahan master data dan approval tidak tercampur dengan mutasi stok.
- `StockTakeSession` dan `StockTakeLine` mendukung sesi per warehouse, physical count, variance, submit, approval, automatic adjustment, dan history.
- UI baru menyediakan Audit Log dan Stock Opname, detail drawer/modal, reusable `DataTable`, pencarian, empty state, toast-style notice, serta export CSV.
- `useApiQuery`, `apiRequest`, `ApiError`, dan utility export menjadi fondasi shared frontend. Validasi request tetap terpusat di schema Zod backend.

Migration baru:

```powershell
cd backend
npx prisma migrate deploy
npm run seed:access
```

### Step 1–9: workflow lanjutan

- **Performance:** endpoint operasi mendukung `page` dan `pageSize` dengan batas aman, query utama memakai index status/tanggal, dan database client diregenerate setelah schema berubah.
- **Reorder suggestion:** `/api/operations/reorder-suggestions` menghitung kebutuhan berdasarkan `InventoryBalance.quantityOnHand` dan `Product.minStock`.
- **Barcode workflow:** `/api/operations/stock-lookup` menerima barcode atau SKU dan mengembalikan stok per warehouse. Stock Report dapat diunduh sebagai CSV.
- **Partial receiving:** purchase berstatus `APPROVED` dapat diterima sebagian melalui `POST /api/operations/purchases/:id/receive`; sistem memperbarui `receivedQuantity`, `PARTIALLY_RECEIVED`/`RECEIVED`, dan `StockMovement` dalam satu transaction.
- **Notification center:** `/api/notifications` membuat alert low stock dan approval berdasarkan permission pengguna. Alert tidak mengubah histori `StockMovement`.
- **Attachments:** file PDF, CSV, PNG, JPG, atau WEBP maksimal 10 MB dapat ditautkan ke purchase, sale, adjustment, transfer, expense, payment, atau stock opname melalui `/api/attachments`.
- **Role dashboard:** angka dashboard mengikuti role dan warehouse scope; akun `WAREHOUSE_STAFF` hanya melihat warehouse pada Staff record-nya.
- **Reports/export:** stock report memiliki CSV export dan barcode lookup; endpoint audit tetap mendukung pagination dan filter.
- **Multi-warehouse scope:** Warehouse Staff dipaksa menggunakan warehouse assignment pada read, create, approval, transfer source, stock opname, dashboard, report, dan operations.

Migration workflow disimpan di `backend/prisma/migrations/20261015090000_add_workflow_features/migration.sql`. Jalankan `npx prisma migrate deploy` setelah PostgreSQL aktif sebelum menggunakan notification atau attachment API.

### Reservation, batch/expiry, dan warehouse location

Migration `20261016134951_add_reservation_batches_locations` menambahkan:

- `StockReservation` dan `InventoryBalance.reservedQuantity` untuk alur sale `DRAFT -> RESERVED -> COMPLETED/CANCELLED`. Reserved stock tidak mengurangi on-hand; ketika completed, reservation dikonsumsi dan `StockMovement` dibuat.
- `Product.trackBatch`, `ProductBatch`, serta field batch pada `PurchaseOrderItem`. Receiving menyimpan batch/production/expiry date dan reservasi memakai FEFO untuk produk yang mengaktifkan tracking batch.
- `WarehouseLocation` dengan code, zone, rack, shelf, bin, capacity, dan relasi ke saldo inventory. Lokasi dapat dikelola dari detail Warehouse.
- In-app notification bell yang mengambil event sesuai permission dan warehouse scope. Notifikasi mencakup create/update/deactivate master data, purchase, sale reservation/status, receiving, adjustment, transfer, expense, payment, low stock, dan expiry watchlist.

Setelah pull kode terbaru, jalankan:

```powershell
cd backend
npx prisma migrate deploy
npx prisma generate
```

Untuk data demo batch dan lokasi, jalankan `npm run seed` pada database development yang memang boleh diisi ulang oleh data demo.

# StockFlow — Inventory & Warehouse Management

StockFlow adalah aplikasi full-stack untuk mengelola master produk, gudang, stok, pembelian, penjualan, penyesuaian stok, transfer antar-gudang, biaya, pembayaran, laporan stok, dan akses pengguna berbasis peran.

## Teknologi

- Frontend: Next.js + TypeScript
- Backend: Express + TypeScript
- Database: PostgreSQL + Prisma ORM
- Authentication: session cookie dan role-based permission (RBAC)

## Fitur utama

- Dashboard analitik dengan pie chart, bar chart, line chart, dan progress stock level.
- Master data: category, brand, unit, product, warehouse, staff, supplier, dan customer.
- Operasional: purchase, sale, stock adjustment, stock transfer, expense, dan payment.
- Stock report berbasis `InventoryBalance` dan audit trail berbasis `StockMovement`.
- Upload/import customer CSV dan unduh template PDF warehouse.
- Mode terang/gelap serta akses yang dibatasi menurut permission pengguna.

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

# Dipakai oleh seeder. Minimal 12 karakter.
ADMIN_EMAIL=admin@stockflow.local
ADMIN_PASSWORD=GantiPasswordDemo123!
DEMO_PASSWORD=GantiPasswordDemo123!
```

Untuk frontend, bila URL API perlu diubah, buat `frontend/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:5000/api
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

`npm run seed` mengisi seluruh master data dan transaksi demo. Semua akun di bawah menggunakan nilai `DEMO_PASSWORD`; bila variabel itu kosong, seeder menggunakan `ADMIN_PASSWORD`.

| Role | Email | Cakupan akses |
| --- | --- | --- |
| Administrator | `admin@stockflow.local` | Seluruh menu, user, role, dan pengaturan master data |
| Warehouse Manager | `warehouse.manager@stockflow.local` | Gudang, stok, adjustment, transfer, dan laporan |
| Warehouse Staff | `warehouse.staff@stockflow.local` | Operasional stok dan transfer sesuai permission |
| Procurement | `procurement@stockflow.local` | Supplier, purchase, biaya, pembayaran, dan laporan |
| Auditor | `auditor@stockflow.local` | Akses baca untuk audit dan laporan |

Seeder membuat data siap pakai untuk setiap menu:

- 4 category, 4 brand, 4 unit, dan 10 product
- 3 warehouse, 5 supplier, 5 customer, dan 5 staff
- 5 user dengan 5 role berbeda dan permission role masing-masing
- Purchase order diterima dan pending, sale selesai dan draft
- Stock adjustment posted/draft, transfer completed/in-transit
- Expense, payment, saldo stok, serta stock movement sebagai audit trail

Seeder bersifat idempoten. Menjalankannya kembali memperbarui master/demo account dan hanya menghapus transaksi demo dengan nomor berawalan `SEED-` serta movement dengan catatan `Seed:`. Data operasional lain tidak dihapus.

## Perintah yang tersedia

| Lokasi | Perintah | Kegunaan |
| --- | --- | --- |
| `backend` | `npm run dev` | Menjalankan API dalam mode development |
| `backend` | `npm run build` | Build TypeScript backend |
| `backend` | `npm run typecheck` | Validasi tipe TypeScript |
| `backend` | `npm run seed` | Seed lengkap seluruh aplikasi dan lima role demo |
| `backend` | `npm run seed:access` | Seed permission, role, dan akun akses saja |
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

> Jangan gunakan `npx prisma migrate reset` pada database yang berisi data penting karena perintah tersebut menghapus seluruh isi database.

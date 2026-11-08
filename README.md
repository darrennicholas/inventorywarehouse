# StockFlow — Inventory & Warehouse Management

StockFlow adalah aplikasi full-stack untuk mengelola master produk, gudang, stok, pembelian, penjualan, penyesuaian stok, transfer antar-gudang, biaya, pembayaran, laporan stok, dan akses pengguna berbasis peran.

## Teknologi

- Frontend: Next.js 16.4.3 + React 19.3 + TypeScript (versi sesuai lockfile saat revisi ini)
- Backend: Express + TypeScript
- Database: PostgreSQL + Prisma ORM
- Authentication: session cookie dan role-based permission (RBAC)

## Panduan clone dan setup untuk pemula

Panduan ini menggunakan **Windows dan PowerShell**. Semua perintah yang diawali `cd` dijalankan di terminal, bukan di dalam PostgreSQL. Aplikasi terdiri dari frontend Next.js, backend Express, dan database PostgreSQL.

### 1. Siapkan perangkat lunak

Instal [Git](https://git-scm.com/downloads), [Node.js 22 LTS](https://nodejs.org/), dan [PostgreSQL](https://www.postgresql.org/download/). Di Windows, PostgreSQL dari Laragon juga dapat digunakan. Pastikan server PostgreSQL aktif, lalu buka PowerShell dan periksa:

```powershell
git --version
node --version
npm --version
```

Jika perintah tidak dikenali, tutup dan buka kembali terminal setelah instalasi, lalu periksa apakah program sudah masuk `PATH`. Catat nama pengguna, password, dan port PostgreSQL Anda; port bawaan biasanya `5432`.

### 2. Clone repository

Pilih folder tempat project akan disimpan, contohnya `C:\laragon\www`, kemudian jalankan:

```powershell
cd C:\laragon\www
git clone https://github.com/darrennicholas/inventorywarehouse.git
cd inventorywarehouse
```

Jika folder `inventorywarehouse` sudah ada, buka folder tersebut dengan `cd` dan gunakan `git pull` sesuai kebutuhan. Perintah berikutnya pada bagian setup mengasumsikan terminal sedang berada di root project `inventorywarehouse`.

### 3. Buat database development

Buat database PostgreSQL kosong bernama `inventorywarehouse` menggunakan pgAdmin atau terminal PostgreSQL. Contoh menggunakan `psql`, jika tersedia di `PATH`:

```powershell
psql -U postgres -h 127.0.0.1 -p 5432 -c "CREATE DATABASE inventorywarehouse;"
```

Masukkan password PostgreSQL jika diminta. Jika database dengan nama itu sudah ada, gunakan database development lain dan sesuaikan namanya pada `DATABASE_URL`. Pastikan akun PostgreSQL memiliki hak mengakses dan membuat tabel di database tersebut.

### 4. Buat dan isi file konfigurasi

Dari root project, salin template:

```powershell
Copy-Item backend/.env.example backend/.env
Copy-Item frontend/.env.example frontend/.env.local
```

Buka `backend/.env` menggunakan editor. Sesuaikan nilai berikut dengan PostgreSQL dan akun development Anda:

```env
DATABASE_URL="postgresql://postgres:PASSWORD_DATABASE@127.0.0.1:5432/inventorywarehouse?schema=public"
SESSION_SECRET=GANTI_DENGAN_RANDOM_SECRET_MINIMAL_32_KARAKTER
FRONTEND_URL=http://localhost:3000
ADMIN_EMAIL=admin@stockflow.local
ADMIN_PASSWORD=GantiDenganPasswordAdminMinimal12Karakter!
```

`PASSWORD_DATABASE` adalah placeholder, bukan password yang otomatis tersedia. Jika username atau password mengandung karakter khusus URL seperti `@`, `:`, `/`, `?`, atau `#`, lakukan URL encoding pada bagian username/password. Untuk membuat nilai acak bagi `SESSION_SECRET`, jalankan `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`, lalu salin hasilnya ke file `.env`. Sesuaikan juga email dan password akun role lainnya di file yang sama; password seed minimal 12 karakter.

Buka `frontend/.env.local`. Untuk port bawaan, isinya:

```env
NEXT_PUBLIC_API_URL=http://localhost:5000
```

Jangan masukkan `.env` atau `.env.local` ke Git. Nilai pada `.env.example` adalah contoh dan perlu disesuaikan, termasuk lokasi attachment jika dipakai.

### 5. Instal backend dan siapkan tabel

Dari root project:

```powershell
cd backend
npm ci
npx prisma generate
npx prisma migrate deploy
npm run seed:access
```

`migrate deploy` membuat atau memperbarui tabel berdasarkan migration yang tersedia; periksa `DATABASE_URL` sebelum menjalankannya. `seed:access` membuat role, permission, dan lima akun akses awal (satu per role) dari konfigurasi `.env`; akun yang sudah ada tidak diubah. Akun Warehouse Staff baru perlu dihubungkan ke staff/gudang sebelum akses yang dibatasi gudang dapat digunakan.

Untuk mencoba tampilan lengkap, pada **database development yang boleh diisi ulang** jalankan `npm run seed`. Seeder lengkap menyiapkan sedikitnya 10 contoh untuk setiap daftar demo utama: kategori, merek, satuan, produk, gudang/lokasi, supplier, customer, staff, akun, purchase, sale, fulfillment, adjustment, transfer, expense, pembayaran, penerimaan barang, retur, stock opname, karantina, relokasi, audit, dan notifikasi. Data transaksi memakai seluruh status yang tersedia, termasuk tahap draft, menunggu persetujuan, revisi, selesai, dan batal sesuai modulnya. Laporan/dashboard mengambil data dari transaksi dan stok demo tersebut.

Status demo yang dicakup:

| Menu | Status contoh |
| --- | --- |
| Purchase | `DRAFT`, `PENDING`, `APPROVED`, `PARTIALLY_RECEIVED`, `RECEIVED`, `CANCELLED` |
| Sale | `DRAFT`, `RESERVED`, `PICKING`, `PACKED`, `PARTIALLY_SHIPPED`, `SHIPPED`, `COMPLETED`, `CANCELLED` |
| Fulfillment | `PICKING`, `PACKED`, `SHIPPED`, `COMPLETED`, `CANCELLED` |
| Adjustment | `DRAFT`, `REVISION`, `POSTED`, `CANCELLED` |
| Transfer | `DRAFT`, `REVISION`, `IN_TRANSIT`, `COMPLETED`, `CANCELLED` |
| Payment | `PENDING`, `PAID`, `VOID` |
| Penerimaan barang | `POSTED`, `CANCELLED` |
| Purchase/Sales Return | `DRAFT`, `PENDING`, `APPROVED`, `POSTED`, `CANCELLED` |
| Inspeksi retur | `PENDING`, `COMPLETED`, `FOLLOW_UP` |
| Stock Opname | `DRAFT`, `COUNTING`, `SUBMITTED`, `APPROVED`, `CANCELLED` |
| Karantina | `PENDING`, `APPROVED`, `REJECTED` |
| Batch | `ACTIVE`, `EXPIRED`, `QUARANTINED`, `DEPLETED` |
| Relokasi lokasi | `COMPLETED`, `CANCELLED` |

Jika belum ada kebijakan approval, full seed membuat matriks default 9 rentang approval; kebijakan yang sudah ada dibiarkan. Data demo tidak membuat attachment atau file palsu.

Full seed membuat 10 akun: dua akun untuk masing-masing dari lima role sistem. Akun kedua memakai email `admin.demo2@stockflow.local`, `warehouse.manager.demo2@stockflow.local`, `warehouse.staff.demo2@stockflow.local`, `procurement.demo2@stockflow.local`, dan `auditor.demo2@stockflow.local`. Password mengikuti konfigurasi password role yang sama pada `backend/.env` (`ADMIN_PASSWORD`, `WAREHOUSE_MANAGER_PASSWORD`, `WAREHOUSE_STAFF_PASSWORD`, `PROCUREMENT_PASSWORD`, atau `AUDITOR_PASSWORD`; role non-admin memakai `DEMO_PASSWORD` sebagai fallback). Gunakan password development yang kuat dan jangan membagikan file `.env`.

> `npm run seed` menghapus lalu membuat ulang catatan demo dengan prefix `SEED-`, dan mengatur ulang saldo contoh pada produk/gudang demo. Jalankan hanya di database development yang memang boleh diisi ulang; jangan jalankan di database operasional atau database yang berisi contoh buatan sendiri dengan prefix tersebut. Seed tidak membuat file attachment palsu.

### 6. Jalankan aplikasi

Biarkan terminal backend tetap terbuka. Dari folder `backend`, jalankan:

```powershell
npm run dev
```

Buka **terminal kedua** di root project, lalu jalankan:

```powershell
cd frontend
npm ci
npm run dev
```

Buka [http://localhost:3000](http://localhost:3000). Masuk menggunakan `ADMIN_EMAIL` dan `ADMIN_PASSWORD` yang telah Anda isi sebelum `seed:access`. Backend biasanya tersedia di `http://localhost:5000`; buka [pemeriksaan API](http://localhost:5000/api/health) dan [pemeriksaan database](http://localhost:5000/api/database-check) untuk memastikan keduanya merespons. Untuk menghentikan masing-masing server, tekan `Ctrl+C` pada terminalnya.

### 7. Jika ada kendala

- **Database tidak terhubung:** pastikan PostgreSQL berjalan, database sudah dibuat, dan username, password, port, serta nama database di `DATABASE_URL` benar. Periksa URL encoding untuk karakter khusus.
- **Login gagal:** pastikan `seed:access` berhasil dan gunakan nilai email/password yang berlaku saat akun dibuat. Seeder tidak mengganti password akun yang sudah ada.
- **Port sudah digunakan:** hentikan proses yang memakai port tersebut, atau sesuaikan `PORT`, `FRONTEND_URL`, dan `NEXT_PUBLIC_API_URL` agar saling cocok, lalu restart server.
- **Perubahan frontend tidak terlihat:** pastikan terminal frontend berjalan dan muat ulang browser. Jika konfigurasi `.env.local` diubah, restart frontend.
- **Prisma Client belum tersedia atau skema tidak cocok:** dari folder `backend`, jalankan `npx prisma generate` dan periksa `npx prisma migrate status` terhadap database yang benar.

## Pengembangan dan pemeliharaan

### Siklus perubahan kode

1. Buat branch kerja dari `main` dan ubah source/migration yang relevan.
2. Untuk perubahan Prisma, edit `backend/prisma/schema.prisma`, buat migration bernama dengan `npx prisma migrate dev --name <nama-singkat>` hanya pada database development, lalu commit folder migration dan schema. Pada server/CI gunakan `npx prisma migrate deploy`, bukan `migrate dev`.
3. Jalankan `npm run typecheck`, `npm test`, dan `npm run build` di `backend`; jalankan `npx tsc --noEmit`, `npm run lint`, `npm test`, dan `npm run build` di `frontend`.
4. Push branch dan buat Pull Request. GitHub Actions menjalankan pemeriksaan frontend dan backend dengan PostgreSQL sementara, migration, dan integration tests.
5. Merge setelah CI lulus. Deploy source dan environment production, ambil backup, terapkan migration, generate Prisma client/build sesuai platform, lalu smoke-test login, izin role, operasi stok, lampiran, dan health check.

### Backup dan pemulihan

Pada Windows dengan PostgreSQL tools di `PATH`, jalankan `powershell -ExecutionPolicy Bypass -File backend/scripts/backup-full.ps1`. Script menyimpan custom dump PostgreSQL dan ZIP attachment ke `backend/backups/` (folder ini di-ignore Git). `pg_dump` saja bukan bukti pemulihan: lakukan `pg_restore` dan ekstrak attachment ke environment uji terpisah, lalu cocokkan dokumen dan lampiran sebelum mengandalkan backup tersebut. Simpan salinan backup di media terenkripsi di luar repository.

### Apa yang masuk GitHub

Commit source, migration SQL, lockfile, dokumentasi, `.env.example`, dan workflow CI. Jangan commit environment rahasia, `node_modules`, hasil build/cache, generated Prisma client, upload/storage, dump/backup, log, atau file lokal IDE. Aturan rinci ada di root `.gitignore` dan `.gitignore` tiap package.

## Fitur utama

- Dashboard analitik dengan filter tanggal/warehouse, KPI, grafik tren pergerakan stok, donut kategori, distribusi status, perbandingan stok warehouse/produk, nilai transaksi bulanan, dan reorder queue.
- Master data: category, brand, unit, product, warehouse, staff, supplier, dan customer.
- Operasional: purchase, sale, stock adjustment, stock transfer, expense, dan payment.
- Stock report berbasis `InventoryBalance` dan audit trail berbasis `StockMovement`.
- Perlindungan stok atomik untuk mencegah saldo negatif saat transaksi bersamaan.
- Approval workflow untuk purchase, adjustment, dan transfer dengan permission khusus.
- Upload/import customer CSV dan unduh template PDF warehouse.
- Mode terang/gelap serta akses yang dibatasi menurut permission pengguna.
- Database constraints untuk mencegah stok/reservasi negatif, rentang stok tidak valid, lokasi relokasi sama, dan approval matrix yang tumpang tindih.
- Penyimpanan attachment configurable dan persistent dengan pemeriksaan ukuran, MIME signature, nama storage acak, serta download berbasis permission.
- Server-side pagination dan pencarian tersedia pada master data, transaksi, return, fulfillment, audit log, notifikasi, attachment, stock report, batch, dan expiry report. Antrean Dashboard, karantina, sumber purchase, dan target kredit juga memiliki halaman dan pencarian.
- Snapshot penutupan valuasi harian per produk/gudang mulai tercatat sejak migration dipasang; data masa lalu sebelum snapshot pertama tidak direka ulang.
- Kapasitas lokasi dapat menjadi batas opsional untuk `ITEM_UNITS`: aktifkan di detail lokasi dengan kapasitas positif. Penambahan stok memeriksa kapasitas dalam transaksi. Pallet dan meter kubik masih berupa informasi karena dimensi dan kemasan produk belum tersedia.
- CI GitHub Actions memvalidasi migration pada PostgreSQL disposable, backend typecheck/tests/build, serta frontend typecheck/lint/tests/build.

## Revisi transaksi & costing — 30 Oktober 2026

1. **COGS saat shipment:** `SALE_ISSUE.unitCost` menyimpan snapshot moving weighted average (WAC) per produk/gudang, bukan harga jual. `costMethod=WAC` membedakan snapshot baru dari data lama yang belum terverifikasi.
2. **Satu alur Sale:** `DRAFT → RESERVED → PICKING → PACKED → SHIPPED/PARTIALLY_SHIPPED → COMPLETED`. Sale selesai setelah seluruh barang dikirim dan seluruh shipment selesai; edit status umum tidak dapat mengeluarkan stok atau melewati fulfillment. Pelepasan reservasi wajib alasan, tanpa shipment aktif.
3. **Receiving rusak:** jumlah baik boleh nol selama jumlah rusak positif. Baik + rusak tidak boleh melebihi sisa PO. Barang baik masuk STORAGE, barang rusak masuk lokasi `RECEIVING-DAMAGED` bertipe QUARANTINE; keduanya tercatat sebagai stok fisik dan goods receipt terpisah. Barang rusak tidak tersedia untuk dijual. Batch kedaluwarsa hanya boleh diterima ke karantina.
4. **Tindak lanjut karantina:** buka **Warehouse → View → Tindak lanjut karantina**. Ajukan pelepasan ke STORAGE, scrap, atau return supplier; reviewer berbeda memeriksa catatan dan nominal. Persetujuan memposting mutasi atomik beserta audit. Return supplier memerlukan purchase asal dan bukti receipt, serta menghasilkan Purchase Return `POSTED`. Batch kedaluwarsa tidak dapat dilepas; batch yang dikarantina secara global hanya bisa dilepas seluruhnya tanpa reservasi. Antrean saldo, keputusan, dan purchase asal mendukung pencarian serta pagination.
5. **Refund/kredit:** buka detail Return yang sudah `POSTED`. Return mengurangi tagihan asal secara proporsional (termasuk diskon/pajak invoice); refund/kredit hanya boleh sebesar hak return dan kelebihan pembayaran yang belum diselesaikan. Refund uang dibatasi pembayaran uang yang benar-benar tercatat. Kredit hanya untuk invoice aktif lain milik supplier/customer yang sama, dibatasi saldo kredit dan sisa tagihan. Settlement asli tidak diedit/dihapus; aksi **Catat pembalikan** membuat satu entri kompensasi immutable. Kredit yang sudah diaplikasikan tidak dapat dibalik. Pembalikan refund harus didukung bukti dana benar-benar dipulihkan. Aplikasi mencatat bukti, **bukan integrasi transfer bank**.
6. **Valuasi & profit:** Dashboard mengikuti filter periode/gudang untuk penjualan neto, COGS dan gross profit berdasarkan shipment serta return posted; Stock Report juga menampilkan ringkasannya (default 30 hari). Nilai stok menggunakan saldo fisik saat ini atau snapshot tepat pada tanggal historis yang dipilih; tanggal yang tidak memiliki snapshot ditandai tidak tersedia. CSV saldo bermodal belum diketahui tersedia untuk rekonsiliasi (maks. 10.000 baris), tetapi tidak mengubah database. Pajak pembelian tidak dikapitalisasi dan penjualan neto tidak memasukkan pajak. Modal tidak diketahui tidak dianggap nol; profit lengkap ditahan bila ada pergerakan bermodal tidak diketahui. Nilai ini bukan laba bersih.
7. **Pemisahan domain:** route finance tunggal berada di `finance.routes.ts`, laporan/relokasi di `inventory-report.routes.ts`, settlement di `settlement.routes.ts`, karantina di `quarantine.routes.ts`, dan costing/profit di `valuation.routes.ts` + `costing.service.ts`. Entry point dan URL `/api/operations` tetap sama. Jalur posting lama yang tidak terpakai dan route finance duplikat dihapus.

### Modal lama dan akses role

Migration tidak mengarang modal dari harga jual atau harga beli terakhir. Untuk saldo lama bermodal kosong, pilih produk/gudang di **Stock Report → Jejak pergerakan stok → Tetapkan modal awal** menggunakan bukti nilai persediaan. Aksi memerlukan `inventory.read` dan `adjustments.approve`, serta kebijakan nominal ADJUSTMENT. Hanya saldo dengan modal `null` yang dapat diinisialisasi; snapshot jumlah diperiksa ulang dan alasannya diaudit. Ini **tidak memperbaiki COGS historis secara retroaktif**. Adjustment/opname dengan variance bermodal belum diketahui memerlukan inisialisasi ini sebelum persetujuan.

Preset berikut adalah default kode, bukan penggantian permission yang telah Anda konfigurasi di database:

| Aksi | Permission yang diperlukan | Role default |
| --- | --- | --- |
| Ajukan pelepasan/scrap karantina | `inventory.write` | Admin, Warehouse Manager, Warehouse Staff (gudang sendiri) |
| Ajukan return supplier dari karantina | di atas + `purchases.read`, `purchase-returns.write` | Admin, Warehouse Manager, Warehouse Staff |
| Review karantina | `adjustments.approve`, policy nominal, bukan pengaju | Admin, Warehouse Manager |
| Review return supplier karantina | di atas + `purchase-returns.approve`, policy RETURN | Admin, Warehouse Manager |
| Lihat refund/kredit | `payments.read` + read sesuai jenis return | Admin, Warehouse Manager, Procurement (purchase), Auditor |
| Catat refund/kredit | `payments.write` + approve sesuai jenis return | Admin |
| Aplikasikan kredit | `payments.write` + read invoice/return asal dan gudang tujuan | Admin |
| Lihat valuasi | `reports.read` + `inventory.read`; profit juga `sales.read` | Admin, Warehouse Manager, Auditor; Procurement hanya valuasi |

Tidak ada permission baru yang perlu di-seed. Permission aktual tetap mengikuti `RolePermission` dan assignment gudang. Tidak menjalankan seeder agar akun dan data bisnis lokal tidak tertimpa.

### Pembaruan alur dan kapasitas

Migration `20261108090000_revision_status` dan `20261108100000_optional_capacity_enforcement` diperlukan untuk alur revisi dan batas kapasitas opsional. Migration telah diuji pada database PostgreSQL sementara; periksa status database tujuan secara terpisah. Setelah backup dan pemeriksaan target, gunakan `npx prisma migrate deploy` dan `npx prisma generate`.

Nilai stok historis hanya ditampilkan ketika snapshot tersedia tepat pada tanggal yang dipilih. Snapshot diambil saat backend aktif pada atau setelah 23:55 WIB; jika backend tidak aktif pada jendela tersebut, tanggal itu dapat kosong. Data lama dan tanggal yang terlewat tidak direka ulang. Untuk kapasitas, pembatasan hanya tersedia untuk jumlah unit barang dan berlaku pada semua penambahan stok melalui jalur posting serta pelepasan karantina; kapasitas pallet/volume belum dapat dihitung otomatis.

### Migration dan verifikasi revisi ini

Migration additive: `backend/prisma/migrations/20261030120000_costing_settlement_quarantine/migration.sql`. Menambahkan `InventoryBalance.averageUnitCost`, `StockMovement.costMethod`, tabel `ReturnSettlement`, `CreditApplication`, `QuarantineDecision`, FK, check constraint, serta dukungan receipt rusak-saja. Migration dibungkus transaction PostgreSQL.

Migration `20261104120000_return_settlement_reversals`, `20261104130000_warehouse_capacity_unit`, dan `20261104140000_daily_inventory_valuation_snapshots` menambah reversal settlement, satuan kapasitas, dan snapshot stok harian. Status migration pada database tujuan harus diperiksa secara terpisah. Sebelum menjalankan `npx prisma migrate deploy` dari `backend`, verifikasi host/nama database, buat backup baru, dan uji pemulihan serta migration pada salinan database. Sesudah deploy jalankan `npx prisma generate`, restart backend/frontend, dan verifikasi status migration. Jangan memakai reset/seed untuk memperbarui database operasional.

Pemeriksaan yang dijalankan: lihat catatan review untuk revisi bertanggal 30 Oktober. Uji transaksi bersamaan, uji browser menyeluruh, restore drill, dan penetration test **belum dijalankan**. Sebelum rilis ikuti [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) pada database/storage uji. Catatan batas review tersedia di [SECURITY_REVIEW.md](SECURITY_REVIEW.md).

## Data demo dan akun login

Akun development dibuat dari nilai `*_EMAIL` dan `*_PASSWORD` pada `backend/.env`. `seed:access` menambahkan akun yang belum ada dan mempertahankan akun yang sudah ada. `npm run seed` menyediakan master data dan transaksi demo serta dapat memperbarui atau mengganti data contoh; gunakan hanya pada database development yang memang boleh diisi ulang.

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
| `backend` | `npm run seed` | Seed 10 akun (2 per role), data contoh per menu, dan seluruh status transaksi pada database development |
| `backend` | `npm run seed:access` | Seed permission, role, dan akun akses saja |
| `backend` | `npm test` | Unit test permission; integration test dilewati secara default |
| `backend` | `npm run test:integration` | Test concurrency dan rollback PostgreSQL |
| `backend` | `npm run db:backup` | Membuat backup PostgreSQL format custom di `backend/backups` |
| `frontend` | `npm run dev` | Menjalankan UI Next.js |
| `frontend` | `npm run build` | Build production frontend |
| `frontend` | `npm run lint` | Lint frontend |
| `frontend` | `npm test` | Uji event action dan lifecycle loading |

## Upgrade Next.js berbasis security

Frontend saat revisi ini memakai `next@16.4.3` dan `eslint-config-next@16.4.3`. Konfigurasi `frontend/next.config.ts` menetapkan `experimental.agentUpgrade: "security"` agar workflow upgrade berfokus pada pembaruan keamanan.

Untuk menjalankan upgrade dari CLI, masuk ke folder `frontend`, lalu jalankan:

```powershell
npx next upgrade --agent security
npm install
npm ls next --depth=0
npm run build
```

Tinjau `frontend/package.json`, `frontend/package-lock.json`, `frontend/next.config.ts`, dan file lain yang mungkin diubah codemod sebelum commit. **Commit `package-lock.json`** agar versi dependency konsisten di mesin lain/CI. Jangan commit `node_modules`, `.next`, atau file environment lokal; semuanya diabaikan oleh `.gitignore`.

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

Jalankan `npm test` untuk tes tanpa database ketika `RUN_INTEGRATION_TESTS` tidak diaktifkan. Untuk tes integrasi, gunakan database uji terpisah dengan nama mengandung `test`, terapkan migration dan jalankan `npm run seed:access`, lalu `npm run test:integration`. Tes membuat serta membersihkan data sementara; jangan arahkan ke database operasional.

Backup manual dapat dibuat dengan `npm run db:backup`. File backup sengaja diabaikan Git melalui `backend/backups/`; simpan salinan backup di lokasi terpisah atau object storage. Script membutuhkan executable `pg_dump` dari instalasi PostgreSQL. API juga mengeluarkan JSON structured error log dan `X-Request-Id` agar error mudah dicari di log collector.

**Latihan restore:** buat database PostgreSQL kosong dan terisolasi khusus uji restore secara manual, lalu gunakan `pg_restore --no-owner --no-privileges --dbname="<koneksi database uji kosong>" "<path backup .dump>"`. Pastikan nama dan host benar-benar menunjuk ke database uji, bukan database operasional; jangan gunakan `--clean` pada database yang berisi data penting. Periksa hasil restore, relasi, jumlah data, dan aplikasi menggunakan kredensial uji. File attachment di storage terpisah juga perlu dibackup dan dipulihkan; dump PostgreSQL saja tidak berisi file tersebut. Jangan menyimpan URL/kredensial asli di Git atau membagikannya di log.

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

`modules/operations/operations.routes.ts` menjadi entry point router. Finance dan analitik dashboard dipisahkan ke `finance.routes.ts` dan `dashboard.routes.ts`; route transaksi yang belum dipisah tetap berada di `transaction.routes.ts` agar URL `/api/operations/*` kompatibel. Dashboard menerima filter `from`, `to`, dan `warehouseId`; rentang tanggal dibatasi maksimal 366 hari dan pilihan warehouse mengikuti warehouse scope role.

Stock report, batch, dan expiry report mendukung `page`/`pageSize` dengan query database, sedangkan purchase return, sales return, dan fulfillment sudah memakai pagination database. Ringkasan dashboard tetap menghitung agregat untuk warehouse yang diizinkan. Endpoint notifikasi menyimpan cache refresh singkat per user agar pembacaan bell tidak terus memindai seluruh saldo stok.

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

- `StockReservation` dan `InventoryBalance.reservedQuantity` menahan stok selama Sale belum dikirim. Fulfillment mengonsumsi reservasi dan membuat `StockMovement` saat shipment; completion tidak mengurangi stok untuk kedua kalinya.
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

### Alur transaksi dan informasi stok

- Detail Purchase, Sale, Adjustment, Transfer, Return, dan Stock Opname menampilkan tahap transaksi serta tindakan berikutnya. Detail dokumen yang memerlukan approval juga menampilkan role approver berdasarkan kebijakan nominal dan riwayat submit, persetujuan, atau penolakan dari `AuditLog`.
- Pembuat dokumen tidak dapat menyetujui atau menolak dokumen sendiri, termasuk jika kebijakan lama memiliki `requiresDifferentCreator: false`. Pemeriksaan berlaku di backend. Transfer baru harus dibuat sebagai draft sebelum disetujui.
- Penolakan membutuhkan alasan minimal lima karakter. Purchase dan Return dikembalikan ke draft; Stock Opname kembali ke tahap menghitung. Adjustment dan Transfer berpindah ke `REVISION`, lalu pembuat dapat mengedit dan mengajukan ulang dokumen yang sama. Riwayat penolakan dan revisi dicatat; persetujuan harus dilakukan pengguna berbeda.
- Form Sale, Adjustment, dan Transfer menampilkan stok fisik, stok direservasi, stok yang dapat dialokasikan, serta rincian lokasi/batch. Ini adalah gambaran saat form dibuka; backend tetap memvalidasi stok saat transaksi diproses.
- Stock Report menyediakan jejak pergerakan per produk dan gudang beserta dokumen sumber sesuai permission. Saldo historis dihitung mundur dari saldo terkini; perubahan lama yang tidak memiliki `StockMovement` tidak dapat direkonstruksi secara pasti.

Bagian workflow ini menggunakan tabel yang sudah tersedia. Revisi costing/settlement/karantina terbaru tetap membutuhkan migration yang dijelaskan di atas. Restart backend dan frontend setelah memperbarui kode.

### Penyimpanan, laporan, dan notifikasi

- Action menampilkan modal loading global singkat dan tetap terbuka selama request yang dipicu action masih berlangsung. Perpindahan menu tidak menampilkan modal. Permintaan perubahan identik yang masih berlangsung digabung untuk mengurangi pengiriman ganda; validasi dan idempotensi backend tetap diperlukan.
- Stock Report dan Payment Report menyediakan reset filter dan ekspor CSV untuk seluruh data yang cocok dengan filter, bukan hanya halaman yang terlihat. Stock Report menunjukkan saldo terkini per gudang; Payment Report memakai rentang tanggal transaksi dalam WIB. Audit Log memiliki filter server-side dan ekspor CSV dengan kriteria yang diterapkan.
- Notifikasi low stock, approval, dan transaksi yang didukung dapat membuka dokumen terkait sesuai permission serta cakupan gudang saat ini. Notifikasi master data yang belum memiliki tautan langsung tetap ditampilkan sebagai informasi. Filter belum dibaca dan opsi pengelompokan tersedia; pengelompokan berlaku pada halaman notifikasi yang sedang ditampilkan dan disimpan per akun di browser.
- Event identik untuk dokumen dan pesan yang sama dicegah agar tidak tercatat berulang dalam interval lima menit; histori yang sudah ada tidak dihapus. Tidak diperlukan migration baru untuk perubahan ini.

### Perlindungan batch dan pemeriksaan stok

- Penerimaan dan transfer tidak lagi mengaktifkan batch kedaluwarsa atau karantina maupun menimpa tanggal batch yang sudah ada. Pengiriman juga memeriksa kembali status dan expiry batch yang direservasi. Batch habis (`DEPLETED`) masih dapat dipakai kembali jika tanggalnya valid dan tidak dikarantina.
- Form penerimaan meminta konfirmasi untuk barang yang kedaluwarsa dalam 30 hari; batch yang sudah kedaluwarsa ditolak dari stok baik dan hanya dapat diterima sebagai rusak ke karantina. Tanggal batch yang bertentangan tidak ditimpa saat receiving.
- Di Stock Report, pilih produk dan gudang pada jejak stok lalu gunakan **Periksa stok** untuk membandingkan saldo, lokasi, reservasi aktif, dan batch. Pemeriksaan bersifat baca-saja; riwayat pergerakan lama mungkin tidak mencakup saldo awal.
- Analitik reorder memperhitungkan sisa purchase berstatus disetujui atau diterima sebagian pada gudang yang diizinkan, jika pengguna memiliki `purchases.read`. Tanpa permission itu nilai incoming tidak tersedia dan estimasi belum memasukkannya.
- Sales Return hanya boleh di-restock ke stok layak jual jika kondisi item `GOOD`; barang dengan kondisi lain harus menggunakan quarantine atau scrap. Status inspeksi dokumen/item terpisah dari disposition dan perubahan stok.

### Ringkasan pembayaran dan stok tersedia

- Detail Purchase/Sale menampilkan tagihan setelah return, pembayaran `PAID`, kredit masuk, settlement return, sisa tagihan dan kelebihan bayar; hingga 50 pembayaran terbaru. Pembayaran `VOID` tidak dapat diubah. Pembayaran yang mendanai refund/kredit tidak bisa di-void hingga melanggar saldo. Pembatalan invoice tidak dapat menghilangkan penerimaan stok atau entry keuangan yang sudah tercatat.
- Dashboard, laporan stok, dan notifikasi stok rendah menghitung stok tersedia dari lokasi penyimpanan aktif dan batch yang masih layak setelah reservasi. Detail karantina, kedaluwarsa, dan stok tidak tersedia lain bisa dilihat dengan memilih produk pada jejak stok di Stock Report. Saldo lama yang tidak memiliki detail lokasi dihitung sebagai belum terverifikasi, bukan otomatis tersedia; pemeriksaan stok tidak mengubah saldo.
- Riwayat detail transaksi menampilkan hingga 50 audit event yang tersedia; histori lama tidak direkonstruksi. Valuasi terbaru memakai WAC, bukan harga pembelian terakhir; kelengkapan modal ditampilkan agar profit tidak menyesatkan.

### Tindak lanjut transaksi dan pemeriksaan return

- Dashboard menampilkan transaksi yang belum berubah selama `STOCKFLOW_ATTENTION_DAYS` hari (default 7, rentang 1–365). Daftar Dashboard mendukung pencarian dan halaman per jenis dokumen sesuai permission dan scope gudang. Refresh notifikasi masih memproses maksimal 10 dokumen tertua per jenis setiap kali. `STOCKFLOW_ATTENTION_REPEAT_DAYS` mengatur pengingat ulang (0 berarti nonaktif). Notifikasi lama tetap tersimpan dan diberi penanda jika status atau akses sudah berubah.
- Pada rekomendasi dashboard, pengguna dengan `purchases.write` dan `inventory.read` dapat membuat **draft** setelah memilih gudang, supplier, jumlah, dan harga. Rekomendasi di form dihitung ulang per gudang dari ketersediaan, PO disetujui yang belum diterima, pemakaian 30 hari, dan lead time; user tetap perlu memeriksa jumlah sebelum menyimpan dan mengajukan PO. Pengguna tanpa `purchases.read` tidak melihat jumlah barang dalam perjalanan.
- Di detail sale `RESERVED`, pengguna `sales.write` dapat melepas reservasi dengan alasan dan konfirmasi. Sale kembali ke draft; pelepasan ditolak jika ada shipment yang belum dibatalkan. Status sale yang sudah lanjut ke fulfillment tidak dapat dilepas melalui aksi ini.
- Detail return memiliki status pemeriksaan terpisah (`PENDING`, `COMPLETED`, `FOLLOW_UP`) yang tidak mengubah stok. Apabila pemeriksaan telah dicatat, statusnya harus `COMPLETED` sebelum return diposting. Return lama tanpa catatan pemeriksaan tetap mengikuti alur sebelumnya. Perubahan dicatat dalam audit log dan dapat dilakukan oleh user dengan permission write sesuai jenis return dan gudang.
- Pemeriksaan per item mencatat kondisi, rekomendasi disposition, catatan, petugas, dan waktu; foto atau dokumen bukti dapat ditambahkan sebagai attachment pada return. Jika hasil pemeriksaan berbeda dari baris return, posting ditolak dan dokumen perlu dibatalkan serta dibuat ulang. Inspeksi lama tanpa data per item tetap diperbolehkan.
- Detail Purchase/Sale mendukung tanggal jatuh tempo oleh pemilik `payments.write`; perubahan diaudit. Pembayaran sebagian menggunakan Payment. Refund/kredit dan pengurangan tagihan return didukung melalui alur settlement di atas, bukan dengan mengedit total invoice asal.
- Attachment memeriksa permission dokumen serta scope gudang. Pilihan form dan agregasi dashboard juga dibatasi permission per jenis data. Ini adalah perbaikan keamanan pada area yang ditinjau, bukan jaminan audit menyeluruh seluruh endpoint.

Fitur pemeriksaan return dan jatuh tempo memerlukan migration **`20261029090000_return_inspection`**, **`20261030090000_return_item_inspection`**, dan **`20261030100000_payment_due_dates`**. Migration costing/settlement/karantina sebelumnya telah diterapkan ke database lokal; migration pembalikan settlement yang baru harus dijalankan setelah backup dan verifikasi target. Menyalin source code saja tidak menjalankan migration secara otomatis.

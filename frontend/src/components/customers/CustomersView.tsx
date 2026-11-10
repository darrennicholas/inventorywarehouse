"use client";

import { confirmAction } from "@/components/ui/GlobalAlert";
import ActionIconButton from "@/components/ui/ActionIconButton";
import { LoaderCircle } from "@/components/ui/GlobalLoading";
import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { AlertCircle, Download, Eye, Pencil, Plus, RefreshCw, Trash2, Upload, UserRound, X } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import ActionFeedback from "@/components/ui/ActionFeedback";
import StatusBadge from "@/components/ui/StatusBadge";
import DataPagination from "@/components/ui/DataPagination";
import DataTable from "@/components/ui/DataTable";

import { usePagedMaster } from "@/hooks/usePagedMaster";
import { useCustomers } from "@/hooks/useCustomers";
import { customerService } from "@/services/customer.service";
import type { CreateCustomerInput } from "@/types/customer";

type Notice = { type: "success" | "error"; message: string } | null;

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && line[index + 1] === '"') { value += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) { values.push(value.trim()); value = ""; }
    else value += character;
  }
  values.push(value.trim());
  return values;
}

export default function CustomersView() {
  const { can } = useAuth();
  const canWrite = can("customers.write");
  const canDelete = can("customers.delete");

  const {
    saving,
    createCustomer,
    updateCustomer,
    deactivateCustomer,
  } = useCustomers(false);

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const { rows: customers, total, loading, error, reload: fetchCustomers } = usePagedMaster<import("@/types/customer").Customer>("/api/customers", page, pageSize, search, "all", saving, setPage);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<import("@/types/customer").Customer | null>(null);
  const [viewing, setViewing] = useState<import("@/types/customer").Customer | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function downloadTemplate() {
    const content = "code,name,email,phone,address\nCUS-001,Example Customer,customer@example.com,08123456789,Jakarta\n";
    const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "customer-import-template.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImporting(true);
    try {
      const lines = (await file.text()).split(/\r?\n/).filter((line) => line.trim());
      const headers = parseCsvLine(lines.shift() ?? "").map((header) => header.toLowerCase().replace(/^\uFEFF/, ""));
      const required = ["code", "name"];
      if (!required.every((field) => headers.includes(field))) throw new Error("CSV wajib memiliki kolom code dan name.");
      const rows: CreateCustomerInput[] = lines.map((line) => {
        const values = parseCsvLine(line);
        const get = (field: string) => values[headers.indexOf(field)]?.trim() ?? "";
        return { code: get("code"), name: get("name"), email: get("email") || null, phone: get("phone") || null, address: get("address") || null, isActive: true };
      }).filter((row) => row.code && row.name);
      if (rows.length === 0) throw new Error("Tidak ada baris pelanggan valid di file CSV.");
      const result = await customerService.importRows(rows);
      await fetchCustomers();
      setNotice({ type: "success", message: `${result.imported} pelanggan diimpor; ${result.skipped} baris dilewati.` });
    } catch (reason) {
      setNotice({ type: "error", message: reason instanceof Error ? reason.message : "Impor pelanggan gagal" });
    } finally {
      setImporting(false);
    }
  }

  const filteredCustomers = customers;

  function openModal(customer?: import("@/types/customer").Customer) {
    setEditing(customer ?? null);
    setCode(customer?.code ?? "");
    setName(customer?.name ?? "");
    setEmail(customer?.email ?? "");
    setPhone(customer?.phone ?? "");
    setAddress(customer?.address ?? "");
    setFormError("");
    setModalOpen(true);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (code.trim().length < 1 || name.trim().length < 2) {
      setFormError("Kode dan nama pelanggan wajib diisi.");
      return;
    }

    setFormError("");

    try {
      const payload = {
        code: code.trim(),
        name: name.trim(),
        email: email.trim() || null,
        phone: phone.trim() || null,
        address: address.trim() || null,
        isActive: true,
      };
      if (editing) await updateCustomer(editing.id, payload);
      else await createCustomer(payload);

      setModalOpen(false);
      setNotice({
        type: "success",
        message: editing ? "Data pelanggan berhasil diperbarui." : "Pelanggan berhasil ditambahkan.",
      });
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Gagal menyimpan pelanggan"
      );
    }
  }

  async function handleDeactivate(customer: import("@/types/customer").Customer) {
    if (!await confirmAction(`Nonaktifkan pelanggan "${customer.name}"? Data pelanggan tetap disimpan.`)) return;
    try {
      await deactivateCustomer(customer.id);
      setNotice({ type: "success", message: "Pelanggan berhasil dinonaktifkan." });
    } catch (err) {
      setNotice({ type: "error", message: err instanceof Error ? err.message : "Gagal menonaktifkan pelanggan" });
    }
  }

  return (
    <div className="space-y-5">
      {notice && <ActionFeedback message={notice.message} tone={notice.type} onDismiss={() => setNotice(null)} />}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 px-5 py-5 sm:px-7">
          <div>
            <h2 className="text-lg font-bold text-[#182237]">Semua pelanggan</h2>
            <p className="mt-1 text-xs text-slate-400">Kelola data pelanggan</p>
          </div>

          <div className="flex items-center gap-2">
            {canWrite && <><input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(event) => void handleImport(event)} /><button type="button" onClick={downloadTemplate} title="Unduh template CSV" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"><Download size={15} /> Templat CSV</button><button type="button" onClick={() => fileInputRef.current?.click()} disabled={importing} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">{importing ? <LoaderCircle size={15} className="animate-spin" /> : <Upload size={15} />} Impor CSV</button></>}
            <button type="button" onClick={() => void fetchCustomers()} disabled={loading} title="Muat ulang" className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-50">
              <RefreshCw size={17} className={loading ? "animate-spin" : ""} />
            </button>
            {canWrite && <button type="button" onClick={() => openModal()} className="inline-flex items-center gap-2 rounded-full bg-[#3867f6] px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-700">
              <Plus size={15} /> Tambah pelanggan
            </button>}
          </div>
        </div>

        <DataTable
          rows={filteredCustomers}
          loading={loading}
          error={error}
          onRetry={() => void fetchCustomers()}
          search={search}
          onSearch={(value) => { setSearch(value); setPage(1); }}
          searchPlaceholder="Cari pelanggan..."
          empty={<div className="flex flex-col items-center gap-2"><UserRound size={32} className="text-slate-300" /><p className="font-semibold">{search ? "Tidak ada pelanggan yang cocok" : "Pelanggan belum tersedia"}</p><p className="text-xs text-slate-500">Tambahkan pelanggan pertama untuk mulai mengelola data.</p></div>}
          columns={[
            { key: "actions", header: "Aksi", render: (customer) => <div className="flex items-center gap-1"><ActionIconButton label={`Lihat pelanggan ${customer.name}`} icon={Eye} onClick={() => setViewing(customer)} />{canWrite && <ActionIconButton label={`Ubah pelanggan ${customer.name}`} icon={Pencil} variant="warning" onClick={() => openModal(customer)} />}{canDelete && <ActionIconButton label={`Nonaktifkan pelanggan ${customer.name}`} icon={Trash2} variant="danger" disabled={!customer.isActive || saving} onClick={() => void handleDeactivate(customer)} />}</div> },
            { key: "number", header: "No.", align: "right", render: (customer) => (page - 1) * pageSize + filteredCustomers.indexOf(customer) + 1 },
            { key: "code", header: "Kode", render: (customer) => <span className="font-semibold">{customer.code}</span> },
            { key: "name", header: "Nama pelanggan", render: (customer) => <span className="inline-flex items-center gap-2 font-semibold"><UserRound size={16} className="shrink-0 text-blue-600" />{customer.name}</span> },
            { key: "email", header: "Email", className: "max-w-[16rem] truncate", render: (customer) => <span title={customer.email ?? undefined}>{customer.email || "—"}</span> },
            { key: "phone", header: "Telepon", render: (customer) => customer.phone || "—" },
            { key: "address", header: "Alamat", className: "max-w-[16rem] truncate", render: (customer) => <span title={customer.address ?? undefined}>{customer.address || "—"}</span> },
            { key: "status", header: "Status", render: (customer) => <StatusBadge status={customer.isActive ? "ACTIVE" : "INACTIVE"} /> },
            { key: "createdAt", header: "Dibuat", render: (customer) => <span className="whitespace-nowrap">{formatDate(customer.createdAt)}</span> },
          ]}
        />
        <DataPagination page={page} pageSize={pageSize} total={total} totalPages={Math.ceil(total / pageSize)} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} loading={loading} noun="pelanggan" />
      </section>

      {modalOpen && canWrite && (
        <div className="sf-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setModalOpen(false); }}>
          <div role="dialog" aria-modal="true" className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
              <div><h2 className="text-lg font-bold text-slate-800">{editing ? "Ubah pelanggan" : "Tambah pelanggan"}</h2><p className="mt-1 text-xs text-slate-400">{editing ? "Perbarui data pelanggan." : "Tambahkan pelanggan ke StockFlow."}</p></div>
              <button type="button" onClick={() => setModalOpen(false)} disabled={saving} aria-label="Tutup dialog" className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X size={19} /></button>
            </div>

            <form onSubmit={handleSubmit} className="grid gap-4 p-6 sm:grid-cols-2">
              <label className="text-sm font-semibold text-slate-700">Kode pelanggan *<input value={code} onChange={(event) => setCode(event.target.value)} required maxLength={40} placeholder="PLG-001" className="mt-2 w-full rounded-lg border border-slate-200 px-4 py-3 text-sm font-normal outline-none focus:border-blue-500" /></label>
              <label className="text-sm font-semibold text-slate-700">Nama pelanggan *<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} placeholder="PT Contoh" className="mt-2 w-full rounded-lg border border-slate-200 px-4 py-3 text-sm font-normal outline-none focus:border-blue-500" /></label>
              <label className="text-sm font-semibold text-slate-700">Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="customer@example.com" className="mt-2 w-full rounded-lg border border-slate-200 px-4 py-3 text-sm font-normal outline-none focus:border-blue-500" /></label>
              <label className="text-sm font-semibold text-slate-700">Telepon<input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="0812..." className="mt-2 w-full rounded-lg border border-slate-200 px-4 py-3 text-sm font-normal outline-none focus:border-blue-500" /></label>
              <label className="text-sm font-semibold text-slate-700 sm:col-span-2">Alamat<textarea value={address} onChange={(event) => setAddress(event.target.value)} rows={3} placeholder="Alamat pelanggan" className="mt-2 w-full resize-none rounded-lg border border-slate-200 px-4 py-3 text-sm font-normal outline-none focus:border-blue-500" /></label>

              {formError && <div className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-xs text-red-700 sm:col-span-2"><AlertCircle size={17} />{formError}</div>}

              <div className="flex justify-end gap-3 border-t border-slate-100 pt-4 sm:col-span-2">
                <button type="button" onClick={() => setModalOpen(false)} disabled={saving} className="rounded-lg border border-slate-200 px-5 py-2.5 text-xs font-semibold text-slate-600">Batal</button>
                <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-[#3867f6] px-5 py-2.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">{saving ? <LoaderCircle size={16} className="animate-spin" /> : editing ? <Pencil size={16} /> : <Plus size={16} />} {saving ? "Menyimpan..." : editing ? "Perbarui pelanggan" : "Simpan pelanggan"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {viewing && (
        <div className="sf-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setViewing(null); }}>
          <div role="dialog" aria-modal="true" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between"><div><p className="text-xs font-bold uppercase tracking-widest text-blue-600">Detail pelanggan</p><h2 className="mt-1 text-xl font-bold text-slate-900">{viewing.name}</h2></div><button type="button" onClick={() => setViewing(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X size={18} /></button></div>
            <div className="mt-5 grid gap-3 text-sm">{[["Code", viewing.code], ["Email", viewing.email || "—"], ["Phone", viewing.phone || "—"], ["Address", viewing.address || "—"], ["Status", viewing.isActive ? "Active" : "Inactive"]].map(([label, value]) => <div key={label} className="flex items-center justify-between gap-4 rounded-xl bg-slate-50 p-4"><span className="text-slate-500">{label}</span><span className="text-right font-semibold text-slate-800">{value}</span></div>)}</div>
            <div className="mt-6 flex justify-end"><button type="button" onClick={() => setViewing(null)} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Tutup</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

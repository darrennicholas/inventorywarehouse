"use client";

import { useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Eye,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  UserRound,
  X,
} from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";

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
    customers,
    loading,
    saving,
    error,
    fetchCustomers,
    createCustomer,
    updateCustomer,
    deactivateCustomer,
  } = useCustomers();

  const [search, setSearch] = useState("");
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
      if (!required.every((field) => headers.includes(field))) throw new Error("CSV must contain code and name columns.");
      const rows: CreateCustomerInput[] = lines.map((line) => {
        const values = parseCsvLine(line);
        const get = (field: string) => values[headers.indexOf(field)]?.trim() ?? "";
        return { code: get("code"), name: get("name"), email: get("email") || null, phone: get("phone") || null, address: get("address") || null, isActive: true };
      }).filter((row) => row.code && row.name);
      if (rows.length === 0) throw new Error("No valid customer rows found in the CSV file.");
      const result = await customerService.importRows(rows);
      await fetchCustomers();
      setNotice({ type: "success", message: `${result.imported} customers imported; ${result.skipped} rows skipped.` });
    } catch (reason) {
      setNotice({ type: "error", message: reason instanceof Error ? reason.message : "Customer import failed" });
    } finally {
      setImporting(false);
    }
  }

  const filteredCustomers = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return customers;

    return customers.filter((customer) =>
      [customer.code, customer.name, customer.email, customer.phone]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(keyword))
    );
  }, [customers, search]);

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
      setFormError("Code and customer name are required.");
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
        message: editing ? "Customer updated successfully." : "Customer created successfully.",
      });
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Failed to save customer"
      );
    }
  }

  async function handleDeactivate(customer: import("@/types/customer").Customer) {
    if (!window.confirm(`Deactivate customer "${customer.name}"? The record will be retained.`)) return;
    try {
      await deactivateCustomer(customer.id);
      setNotice({ type: "success", message: "Customer deactivated successfully." });
    } catch (err) {
      setNotice({ type: "error", message: err instanceof Error ? err.message : "Failed to deactivate customer" });
    }
  }

  return (
    <div className="space-y-5">
      {notice && (
        <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-sm ${notice.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}>
          {notice.type === "success" ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          <span className="flex-1">{notice.message}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss notification">
            <X size={17} />
          </button>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle size={18} />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => void fetchCustomers()} className="font-semibold underline">
            Retry
          </button>
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 px-5 py-5 sm:px-7">
          <div>
            <h2 className="text-lg font-bold text-[#182237]">All Customers</h2>
            <p className="mt-1 text-xs text-slate-400">Manage customer master data</p>
          </div>

          <div className="flex items-center gap-2">
            {canWrite && <><input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(event) => void handleImport(event)} /><button type="button" onClick={downloadTemplate} title="Download CSV template" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"><Download size={15} /> Template</button><button type="button" onClick={() => fileInputRef.current?.click()} disabled={importing} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">{importing ? <LoaderCircle size={15} className="animate-spin" /> : <Upload size={15} />} Import CSV</button></>}
            <button type="button" onClick={() => void fetchCustomers()} disabled={loading} title="Refresh" className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-50">
              <RefreshCw size={17} className={loading ? "animate-spin" : ""} />
            </button>
            {canWrite && <button type="button" onClick={() => openModal()} className="inline-flex items-center gap-2 rounded-full bg-[#3867f6] px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-700">
              <Plus size={15} /> Add Customer
            </button>}
          </div>
        </div>

        <div className="flex items-center justify-end px-5 py-5 sm:px-7">
          <div className="relative w-full sm:w-72">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search customers..." className="w-full rounded-md border border-slate-200 py-2 pl-9 pr-3 text-xs outline-none focus:border-blue-400" />
          </div>
        </div>

        <div className="overflow-x-auto px-5 sm:px-7">
          <table className="w-full min-w-[850px] text-left text-xs">
            <thead>
              <tr className="border-b-2 border-slate-200 text-slate-700">
                <th className="px-3 py-3 font-bold">No.</th>
                <th className="px-3 py-3 font-bold">Code</th>
                <th className="px-3 py-3 font-bold">Customer Name</th>
                <th className="px-3 py-3 font-bold">Email</th>
                <th className="px-3 py-3 font-bold">Phone</th>
                <th className="px-3 py-3 font-bold">Address</th>
                <th className="px-3 py-3 font-bold">Status</th>
                <th className="px-3 py-3 font-bold">Created</th>
                <th className="px-3 py-3 font-bold">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {!loading && filteredCustomers.map((customer, index) => (
                <tr key={customer.id} className="hover:bg-[#f8faff]">
                  <td className="px-3 py-4 text-slate-500">{index + 1}</td>
                  <td className="px-3 py-4 font-semibold text-slate-700">{customer.code}</td>
                  <td className="px-3 py-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600"><UserRound size={17} /></div>
                      <span className="font-semibold text-slate-800">{customer.name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-4 text-slate-500">{customer.email || "—"}</td>
                  <td className="px-3 py-4 text-slate-500">{customer.phone || "—"}</td>
                  <td className="max-w-[220px] px-3 py-4 text-slate-500">{customer.address || "—"}</td>
                  <td className="px-3 py-4"><span className="rounded-full bg-emerald-50 px-3 py-1 font-semibold text-emerald-700">{customer.isActive ? "Active" : "Inactive"}</span></td>
                  <td className="whitespace-nowrap px-3 py-4 text-slate-500">{formatDate(customer.createdAt)}</td>
                  <td className="whitespace-nowrap px-3 py-4">
                    <button type="button" onClick={() => setViewing(customer)} className="mr-2 inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-2 font-semibold text-slate-600 hover:bg-slate-50"><Eye size={13} /> View</button>
                    {canWrite && <button type="button" onClick={() => openModal(customer)} className="mr-2 inline-flex items-center gap-1 rounded-md bg-sky-500 px-2.5 py-2 font-semibold text-white"><Pencil size={13} /> Edit</button>}
                    {canDelete && <button type="button" disabled={!customer.isActive || saving} onClick={() => void handleDeactivate(customer)} className="inline-flex items-center gap-1 rounded-md bg-red-500 px-2.5 py-2 font-semibold text-white disabled:opacity-35"><Trash2 size={13} /> Delete</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {loading && <div className="flex items-center justify-center gap-2 py-14 text-sm text-slate-500"><LoaderCircle size={19} className="animate-spin" /> Loading customers...</div>}
          {!loading && filteredCustomers.length === 0 && <div className="flex flex-col items-center py-14 text-center"><UserRound size={35} className="text-slate-300" /><h3 className="mt-3 text-sm font-semibold text-slate-700">{search ? "No matching customers" : "No customers found"}</h3><p className="mt-1 text-xs text-slate-400">Add your first customer.</p></div>}
        </div>
      </section>

      {modalOpen && canWrite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setModalOpen(false); }}>
          <div role="dialog" aria-modal="true" className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
              <div><h2 className="text-lg font-bold text-slate-800">{editing ? "Edit Customer" : "Add New Customer"}</h2><p className="mt-1 text-xs text-slate-400">{editing ? "Update customer master data." : "Register a customer in StockFlow."}</p></div>
              <button type="button" onClick={() => setModalOpen(false)} disabled={saving} aria-label="Close modal" className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X size={19} /></button>
            </div>

            <form onSubmit={handleSubmit} className="grid gap-4 p-6 sm:grid-cols-2">
              <label className="text-sm font-semibold text-slate-700">Customer Code *<input value={code} onChange={(event) => setCode(event.target.value)} required maxLength={40} placeholder="CUS-001" className="mt-2 w-full rounded-lg border border-slate-200 px-4 py-3 text-sm font-normal outline-none focus:border-blue-500" /></label>
              <label className="text-sm font-semibold text-slate-700">Customer Name *<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} placeholder="PT Example" className="mt-2 w-full rounded-lg border border-slate-200 px-4 py-3 text-sm font-normal outline-none focus:border-blue-500" /></label>
              <label className="text-sm font-semibold text-slate-700">Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="customer@example.com" className="mt-2 w-full rounded-lg border border-slate-200 px-4 py-3 text-sm font-normal outline-none focus:border-blue-500" /></label>
              <label className="text-sm font-semibold text-slate-700">Phone<input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="0812..." className="mt-2 w-full rounded-lg border border-slate-200 px-4 py-3 text-sm font-normal outline-none focus:border-blue-500" /></label>
              <label className="text-sm font-semibold text-slate-700 sm:col-span-2">Address<textarea value={address} onChange={(event) => setAddress(event.target.value)} rows={3} placeholder="Customer address" className="mt-2 w-full resize-none rounded-lg border border-slate-200 px-4 py-3 text-sm font-normal outline-none focus:border-blue-500" /></label>

              {formError && <div className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-xs text-red-700 sm:col-span-2"><AlertCircle size={17} />{formError}</div>}

              <div className="flex justify-end gap-3 border-t border-slate-100 pt-4 sm:col-span-2">
                <button type="button" onClick={() => setModalOpen(false)} disabled={saving} className="rounded-lg border border-slate-200 px-5 py-2.5 text-xs font-semibold text-slate-600">Cancel</button>
                <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-[#3867f6] px-5 py-2.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">{saving ? <LoaderCircle size={16} className="animate-spin" /> : editing ? <Pencil size={16} /> : <Plus size={16} />} {saving ? "Saving..." : editing ? "Update Customer" : "Save Customer"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {viewing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setViewing(null); }}>
          <div role="dialog" aria-modal="true" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between"><div><p className="text-xs font-bold uppercase tracking-widest text-blue-600">Customer detail</p><h2 className="mt-1 text-xl font-bold text-slate-900">{viewing.name}</h2></div><button type="button" onClick={() => setViewing(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X size={18} /></button></div>
            <div className="mt-5 grid gap-3 text-sm">{[["Code", viewing.code], ["Email", viewing.email || "—"], ["Phone", viewing.phone || "—"], ["Address", viewing.address || "—"], ["Status", viewing.isActive ? "Active" : "Inactive"]].map(([label, value]) => <div key={label} className="flex items-center justify-between gap-4 rounded-xl bg-slate-50 p-4"><span className="text-slate-500">{label}</span><span className="text-right font-semibold text-slate-800">{value}</span></div>)}</div>
            <div className="mt-6 flex justify-end"><button type="button" onClick={() => setViewing(null)} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Close</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

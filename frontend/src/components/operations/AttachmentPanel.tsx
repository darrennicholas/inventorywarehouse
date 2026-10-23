"use client";

import { useEffect, useState } from "react";
import { Download, FileUp, LoaderCircle, Paperclip, Trash2 } from "lucide-react";
import { apiDownload, apiRequest } from "@/lib/api";

type Attachment = { id: string; originalName: string; mimeType: string; sizeBytes: number; createdAt: string };

export default function AttachmentPanel({ entity, entityId, canWrite }: { entity: string; entityId: string; canWrite: boolean }) {
  const [items, setItems] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    try { const result = await apiRequest<{ success: boolean; data?: Attachment[] }>(`/api/attachments?entity=${encodeURIComponent(entity)}&entityId=${encodeURIComponent(entityId)}`); setItems(Array.isArray(result.data) ? result.data : []); } catch (reason) { setItems([]); setError(reason instanceof Error ? reason.message : "Attachments unavailable"); }
  }
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity, entityId]);

  async function upload(file: File) {
    const supported = ["application/pdf", "text/csv", "image/png", "image/jpeg", "image/webp"];
    if (!supported.includes(file.type)) { setError("Use PDF, CSV, PNG, JPG, or WEBP files."); return; }
    if (file.size > 10 * 1024 * 1024) { setError("Maximum file size is 10 MB."); return; }
    setBusy(true); setError("");
    try {
      const base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1] ?? ""); reader.onerror = () => reject(new Error("Cannot read file")); reader.readAsDataURL(file); });
      await apiRequest(`/api/attachments`, { method: "POST", body: JSON.stringify({ entity, entityId, originalName: file.name, mimeType: file.type, contentBase64: base64 }) });
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Upload failed"); } finally { setBusy(false); }
  }
  async function download(id: string, name: string) { const blob = await apiDownload(`/api/attachments/${id}/download`); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url); }
  async function remove(id: string) { if (!window.confirm("Delete this attachment?")) return; await apiRequest(`/api/attachments/${id}`, { method: "DELETE" }); await load(); }

  return <div className="mt-6 rounded-2xl border border-slate-200 p-4"><div className="flex items-center justify-between gap-3"><div><p className="flex items-center gap-2 text-sm font-bold text-slate-800"><Paperclip size={15} className="text-blue-600" /> Documents</p><p className="mt-1 text-xs text-slate-500">Supporting files linked to this record.</p></div>{canWrite && <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700">{busy ? <LoaderCircle size={14} className="animate-spin" /> : <FileUp size={14} />} Upload<input type="file" className="hidden" accept=".pdf,.csv,.png,.jpg,.jpeg,.webp" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.currentTarget.value = ""; }} /></label>}</div>{error && <p className="mt-3 text-xs font-semibold text-red-600">{error}</p>}<div className="mt-3 space-y-2">{items.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2"><div className="min-w-0"><p className="truncate text-xs font-semibold text-slate-700">{item.originalName}</p><p className="text-[10px] text-slate-400">{Math.ceil(item.sizeBytes / 1024)} KB</p></div><div className="flex items-center gap-1"><button type="button" title="Download" onClick={() => void download(item.id, item.originalName)} className="rounded-lg p-2 text-blue-600 hover:bg-blue-100"><Download size={14} /></button>{canWrite && <button type="button" title="Delete" onClick={() => void remove(item.id)} className="rounded-lg p-2 text-red-500 hover:bg-red-100"><Trash2 size={14} /></button>}</div></div>)}{items.length === 0 && <p className="py-3 text-xs text-slate-400">No attachments yet.</p>}</div></div>;
}


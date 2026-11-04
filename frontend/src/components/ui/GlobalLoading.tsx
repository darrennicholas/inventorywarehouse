import { LoaderCircle as Spinner } from "lucide-react";
import type { LucideProps } from "lucide-react";

export function LoaderCircle(props: LucideProps) { return <Spinner aria-hidden="true" {...props} />; }

export default function GlobalLoading({ label = "Memuat data…", compact = false }: { label?: string; compact?: boolean }) {
  return <span role="status" aria-live="polite" className={`inline-flex items-center justify-center gap-2 text-slate-500 dark:text-slate-300 ${compact ? "text-xs" : "text-sm"}`}><LoaderCircle aria-hidden="true" size={compact ? 14 : 18} className="animate-spin text-blue-500" />{label}</span>;
}

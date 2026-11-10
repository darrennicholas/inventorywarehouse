import type { ButtonHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";
type Variant = "neutral" | "primary" | "success" | "warning" | "danger" | "violet";

const variantClass: Record<Variant, string> = {
  neutral: "bg-slate-100 text-slate-600 hover:bg-blue-100 hover:text-blue-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-blue-950 dark:hover:text-blue-300",
  primary: "bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950/50 dark:text-blue-300 dark:hover:bg-blue-900",
  success: "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-300 dark:hover:bg-emerald-900",
  warning: "bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-950/50 dark:text-amber-300 dark:hover:bg-amber-900",
  danger: "bg-rose-50 text-rose-700 hover:bg-rose-100 dark:bg-rose-950/50 dark:text-rose-300 dark:hover:bg-rose-900",
  violet: "bg-violet-50 text-violet-700 hover:bg-violet-100 dark:bg-violet-950/50 dark:text-violet-300 dark:hover:bg-violet-900",
};

type ActionIconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "title"> & {
  label: string;
  icon: LucideIcon;
  variant?: Variant;
};

export default function ActionIconButton({
  label,
  icon: Icon,
  variant = "neutral",
  className = "",
  ...buttonProps
}: ActionIconButtonProps) {
  return (
    <span className="sf-action-icon-wrap">
      <button
        {...buttonProps}
        type={buttonProps.type ?? "button"}
        aria-label={label}
        title={label}
        data-sf-icon-action
        className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition duration-150 hover:-translate-y-0.5 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45 ${variantClass[variant]} ${className}`}
      >
        <Icon size={16} aria-hidden="true" />
      </button>
      <span className="sf-action-icon-tooltip" aria-hidden="true">{label}</span>
    </span>
  );
}

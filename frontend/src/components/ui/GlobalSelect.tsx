import type { ComponentProps } from "react";

/** Shared native dropdown: preserves keyboard, form validation and browser accessibility. */
export default function GlobalSelect({ className = "", ...props }: ComponentProps<"select">) {
  return <select {...props} className={`stockflow-select ${className}`} />;
}

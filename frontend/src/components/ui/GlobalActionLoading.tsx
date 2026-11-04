"use client";

import { useEffect, useRef } from "react";

export const ACTION_REQUEST_EVENT = "stockflow:action-request";
export type ActionRequestEvent = { id: string; phase: "start" | "end"; method: string; endpoint: string };

/** Delays create, edit, and delete actions for one second with a lightweight modal. */
export default function GlobalActionLoading({ children }: { children: React.ReactNode }) {
  const popup = useRef<HTMLDivElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef(false);
  const replayingClick = useRef(false);
  const replayingButton = useRef<HTMLElement | null>(null);
  const replayingSubmit = useRef(false);

  useEffect(() => {
    const removePopup = () => {
      popup.current?.remove();
      popup.current = null;
    };

    const showPopup = () => {
      if (popup.current?.isConnected) return;
      const backdrop = document.createElement("div");
      backdrop.className = "sf-action-loading-backdrop";
      backdrop.setAttribute("role", "presentation");
      backdrop.style.zIndex = "2147483647";

      const dialog = document.createElement("div");
      dialog.className = "sf-action-loading";
      dialog.setAttribute("role", "status");
      dialog.setAttribute("aria-live", "polite");
      dialog.setAttribute("aria-label", "Memproses aksi");

      const spinner = document.createElement("span");
      spinner.className = "sf-action-loading-spinner";
      spinner.setAttribute("aria-hidden", "true");
      const copy = document.createElement("div");
      const title = document.createElement("p");
      title.textContent = "Sedang memproses";
      const description = document.createElement("span");
      description.textContent = "Mohon tunggu sebentar";
      const progress = document.createElement("div");
      progress.className = "sf-action-loading-progress";
      progress.setAttribute("role", "progressbar");
      progress.setAttribute("aria-label", "Progres proses");
      progress.setAttribute("aria-valuemin", "0");
      progress.setAttribute("aria-valuemax", "100");
      progress.setAttribute("aria-valuenow", "0");
      const progressBar = document.createElement("span");
      progressBar.className = "sf-action-loading-progress-bar";
      progress.append(progressBar);
      copy.append(title, description);
      dialog.append(spinner, copy, progress);
      backdrop.append(dialog);
      document.body.append(backdrop);
      popup.current = backdrop;
    };

    const replay = (action: () => void) => {
      showPopup();
      if (timer.current) clearTimeout(timer.current);
      pending.current = true;
      timer.current = setTimeout(() => {
        removePopup();
        pending.current = false;
        action();
        timer.current = null;
      }, 1000);
    };

  const actionKind = (control: HTMLElement): "create" | "edit" | "delete" | null => {
    const label = `${control.getAttribute("aria-label") ?? ""} ${control.getAttribute("title") ?? ""} ${control.textContent ?? ""}`.trim();
    if (/\b(save|simpan|cancel|batal|close|tutup)\b/i.test(label)) return null;
    const iconAction = control.querySelector<HTMLElement>("[data-stockflow-action]")?.dataset.stockflowAction;
    if (iconAction === "delete" || /\b(delete|hapus|deactivate|nonaktifkan)\b/i.test(label)) return "delete";
    if (control instanceof HTMLButtonElement && control.form && control.type === "submit") return null;
    if (control.closest('.sf-modal-overlay, [role="dialog"]') && /\b(add|tambah|create|buat|new)\b/i.test(label)) return null;
    if (iconAction === "edit" || /\b(edit|ubah)\b/i.test(label)) return "edit";
    if (/\b(add|tambah|create|buat|new)\b/i.test(label)) return "create";
    return null;
  };

  const handleClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const control = target.closest<HTMLElement>("button, [role='button']");
      if (!control || (control instanceof HTMLButtonElement && control.disabled)) return;
      if (control.closest("[data-sf-loading-ignore]")) return;

    // Let the synthetic click that we replay after the delay reach React normally.
      if (replayingClick.current && replayingButton.current === control) {
        replayingButton.current = null;
        return;
      }
    const dialog = control.closest<HTMLElement>('[role="alertdialog"]');
    const label = `${control.getAttribute("aria-label") ?? ""} ${control.getAttribute("title") ?? ""} ${control.textContent ?? ""}`.trim();
    const isCancel = /\b(cancel|batal|close|tutup)\b/i.test(label);
    const action = dialog
      ? (isCancel ? null : /\b(delete|hapus|deactivate|nonaktifkan|penghapusan)\b/i.test(dialog.textContent ?? "") ? "delete" : null)
      : actionKind(control);
    if (!action) return;
      if (pending.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      replay(() => {
        if (!control.isConnected || (control instanceof HTMLButtonElement && control.disabled)) return;
        replayingButton.current = control;
        replayingClick.current = true;
        control.click();
        replayingClick.current = false;
        replayingButton.current = null;
      });
    };

  const handleSubmit = (event: SubmitEvent) => {
      if (replayingClick.current || replayingSubmit.current) return;
      const form = event.target;
      const submitter = event.submitter;
    if (!(form instanceof HTMLFormElement) || !(submitter instanceof HTMLElement) || actionKind(submitter) !== "delete") return;
    if (pending.current) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
      event.preventDefault();
      event.stopImmediatePropagation();
      replay(() => {
        if (!form.isConnected) return;
        replayingSubmit.current = true;
        if ((submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement) && submitter.isConnected) form.requestSubmit(submitter);
        else form.requestSubmit();
        replayingSubmit.current = false;
      });
    };

    document.addEventListener("click", handleClick, true);
    document.addEventListener("submit", handleSubmit, true);
    return () => {
      document.removeEventListener("click", handleClick, true);
      document.removeEventListener("submit", handleSubmit, true);
      if (timer.current) clearTimeout(timer.current);
      removePopup();
    };
  }, []);

  return <>{children}</>;
}

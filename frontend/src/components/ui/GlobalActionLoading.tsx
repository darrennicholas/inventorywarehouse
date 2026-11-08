"use client";

import { useEffect, useRef, useState } from "react";
import { clearActionIntent, markActionIntent } from "@/lib/action-intent";

export const ACTION_REQUEST_EVENT = "stockflow:action-request";
export type ActionRequestEvent = { id: string; phase: "start" | "end"; method: string; endpoint: string; userInitiated: boolean };
const MINIMUM_FEEDBACK_MS = 1000;

function isDismissControl(control: HTMLElement) {
  if (control.hasAttribute("data-sf-action-loading-ignore")) return true;
  const label = [control.getAttribute("aria-label"), control.getAttribute("title"), control.textContent]
    .filter(Boolean)
    .join(" ")
    .trim()
    .toLocaleLowerCase();
  return /^(?:cancel|close|batal|tutup)(?:\s|$)/i.test(label);
}

function isActionColumnControl(control: HTMLElement) {
  if (control.closest("[data-sf-action-column]")) return true;
  const cell = control.closest<HTMLTableCellElement>("td");
  const table = cell?.closest("table");
  if (!cell || !table) return false;
  const actionHeaders = Array.from(table.querySelectorAll<HTMLTableCellElement>("thead th, thead td"));
  return actionHeaders.some((header) =>
    header.cellIndex === cell.cellIndex && /^(?:actions?|aksi|tindakan)$/i.test(header.textContent?.trim() ?? "")
  );
}

/** Display a modal only for requests started by an explicit user action. */
export default function GlobalActionLoading({ children }: { children: React.ReactNode }) {
  const [count, setCount] = useState(0);
  const active = useRef(new Set<string>());
  const dialog = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const pending = active.current;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    let feedbackCounter = 0;
    function disableUnconfiguredBrowserSuggestions(root: ParentNode) {
      if (root instanceof HTMLInputElement && root.type !== "password" && !root.hasAttribute("autocomplete")) root.setAttribute("autocomplete", "off");
      if (root instanceof HTMLTextAreaElement && !root.hasAttribute("autocomplete")) root.setAttribute("autocomplete", "off");
      root.querySelectorAll<HTMLInputElement>("input:not([type='password']):not([autocomplete])").forEach((input) => input.setAttribute("autocomplete", "off"));
      root.querySelectorAll<HTMLTextAreaElement>("textarea:not([autocomplete])").forEach((textarea) => textarea.setAttribute("autocomplete", "off"));
    }
    disableUnconfiguredBrowserSuggestions(document);
    const inputObserver = new MutationObserver((records) => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node instanceof HTMLElement) disableUnconfiguredBrowserSuggestions(node);
      }
    });
    inputObserver.observe(document.documentElement, { childList: true, subtree: true });
    function showActionFeedback() {
      const id = `ui:${++feedbackCounter}`;
      pending.add(id);
      setCount(pending.size);
      const timer = setTimeout(() => { timers.delete(timer); pending.delete(id); setCount(pending.size); }, MINIMUM_FEEDBACK_MS);
      timers.add(timer);
    }
    function captureAction(event: Event) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("[data-sf-action-navigation], .sf-action-loading-backdrop")) { clearActionIntent(); return; }
      if (event.type === "submit") {
        const submitter = (event as SubmitEvent).submitter;
        if (!(submitter instanceof HTMLElement) || isDismissControl(submitter) || !isActionColumnControl(submitter)) { clearActionIntent(); return; }
        markActionIntent(); showActionFeedback(); return;
      }
      if (event.type === "change" && target instanceof HTMLInputElement && target.type === "file") {
        const cellAction = isActionColumnControl(target);
        if (cellAction) { markActionIntent(true); showActionFeedback(); } else clearActionIntent();
        return;
      }
      const control = target.closest<HTMLElement>("button, [role='button'], input[type='submit']");
      if (!control || (control instanceof HTMLButtonElement && control.disabled)) return;
      if (isDismissControl(control) || !isActionColumnControl(control)) { clearActionIntent(); return; }
      markActionIntent();
      showActionFeedback();
    }
    function clearNavigationFeedback() {
      for (const id of pending) if (id.startsWith("ui:")) pending.delete(id);
      setCount(pending.size);
    }
    function requestChanged(event: Event) {
      const detail = (event as CustomEvent<ActionRequestEvent>).detail;
      if (!detail) return;
      if (detail.phase === "start") {
        if (!detail.userInitiated || /^\/api\/auth\/me(?:[/?]|$)/.test(detail.endpoint) || (detail.method === "GET" && /^\/api\/notifications(?:[/?]|$)/.test(detail.endpoint))) return;
        pending.add(detail.id);
      } else {
        pending.delete(detail.id);
      }
      setCount(pending.size);
    }
    document.addEventListener("click", captureAction, true);
    document.addEventListener("submit", captureAction, true);
    document.addEventListener("change", captureAction, true);
    window.addEventListener(ACTION_REQUEST_EVENT, requestChanged);
    window.addEventListener("stockflow:action-navigation", clearNavigationFeedback);
    return () => {
      inputObserver.disconnect();
      document.removeEventListener("click", captureAction, true);
      document.removeEventListener("submit", captureAction, true);
      document.removeEventListener("change", captureAction, true);
      window.removeEventListener(ACTION_REQUEST_EVENT, requestChanged);
      window.removeEventListener("stockflow:action-navigation", clearNavigationFeedback);
      timers.forEach(clearTimeout);
      pending.clear();
      clearActionIntent();
    };
  }, []);

  useEffect(() => {
    if (count > 0) {
      if (!previousFocus.current && document.activeElement instanceof HTMLElement) previousFocus.current = document.activeElement;
      dialog.current?.focus();
    } else if (previousFocus.current) {
      if (previousFocus.current.isConnected) previousFocus.current.focus();
      previousFocus.current = null;
    }
  }, [count]);

  return <>{children}{count > 0 && <div className="sf-action-loading-backdrop"><div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="sf-action-title" aria-describedby="sf-action-description" className="sf-action-loading" onKeyDown={(event) => { if (event.key === "Tab") event.preventDefault(); }}><span className="sf-action-loading-spinner" aria-hidden="true" /><div><p id="sf-action-title">Sedang memproses</p><span id="sf-action-description" role="status" aria-live="polite">Mohon tunggu hingga tindakan selesai.</span></div><div className="sf-action-loading-progress" aria-hidden="true"><span className="sf-action-loading-progress-bar" /></div></div></div>}</>;
}

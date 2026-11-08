let actionUntil = 0;

/** Associate requests with the most recent explicit button, form, or file action. */
export function markActionIntent(fileInput = false) {
  actionUntil = Date.now() + (fileInput ? 5000 : 250);
}

export function clearActionIntent() {
  actionUntil = 0;
  if (typeof window !== "undefined") window.dispatchEvent(new Event("stockflow:action-navigation"));
}

export function hasActionIntent() {
  return typeof window !== "undefined" && Date.now() < actionUntil;
}

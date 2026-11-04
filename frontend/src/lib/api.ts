
function normalizeApiUrl(value: string): string {
  return value
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/api$/i, "");
}

function apiUrl(endpoint: string): string {
  const baseUrl = normalizeApiUrl(
    process.env.NEXT_PUBLIC_API_URL ??
      "http://localhost:5000"
  );
  return endpoint.startsWith("/")
    ? `${baseUrl}${endpoint}`
    : `${baseUrl}/${endpoint}`;
}

export async function downloadApiFile(endpoint: string, filename: string) {
  const response = await fetch(apiUrl(endpoint), { credentials: "include", headers: { Accept: "text/csv" } });
  if (!response.ok) throw new Error(`Download gagal (${response.status}). Pastikan Anda memiliki akses laporan dan stok.`);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.click();
  URL.revokeObjectURL(url);
}

let csrfToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;
const pendingMutations = new Map<string, Map<string | null, Promise<unknown>>>();

function userFacingMessage(message: string): string {
  if (/Insufficient (available )?stock/i.test(message)) return "Stok yang dapat digunakan tidak mencukupi. Periksa gudang, lokasi, batch, dan reservasi, lalu muat ulang data sebelum mencoba lagi.";
  if (/Payment exceeds the outstanding balance/i.test(message)) return "Jumlah pembayaran melebihi sisa tagihan. Periksa histori pembayaran dan sesuaikan jumlahnya.";
  if (/Cancel or complete all active shipments/i.test(message)) return "Reservasi belum dapat dilepas karena masih ada shipment aktif. Selesaikan atau batalkan shipment melalui menu Fulfillment terlebih dahulu.";
  if (/Complete the recorded inspection before posting/i.test(message)) return "Pemeriksaan return belum selesai. Ubah hasil pemeriksaan menjadi selesai sebelum mem-posting.";
  if (/Item inspection differs from the return line/i.test(message)) return "Hasil inspeksi berbeda dari detail return. Batalkan dan buat dokumen yang benar sebelum mem-posting.";
  if (/expired or quarantined/i.test(message)) return "Batch kedaluwarsa atau dikarantina tidak dapat dipakai sebagai stok layak jual. Periksa tanggal dan status batch.";
  if (/Sale status changed; reload/i.test(message)) return "Status penjualan berubah oleh proses lain. Muat ulang data dan periksa kembali sebelum mencoba.";
  return message;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export function registerUnauthorizedHandler(
  handler: (() => void) | null
): () => void {
  unauthorizedHandler = handler;

  return () => {
    if (unauthorizedHandler === handler) {
      unauthorizedHandler = null;
    }
  };
}

export function apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  const mutation = !["GET", "HEAD", "OPTIONS"].includes(method);
  const body = options.body;
  // Share identical in-flight writes caused by repeated clicks; distinct payloads
  // and requests with their own abort signal remain independent.
  const dedupe = mutation && !options.signal && (body == null || typeof body === "string") && !/^\/api\/(auth|notifications)(\/|\?|$)/.test(endpoint);
  const headers = new Headers(options.headers);
  const key = dedupe && !headers.has("Idempotency-Key") ? JSON.stringify([method, endpoint, Array.from(headers.entries()).sort()]) : null;
  const bodyKey = typeof body === "string" ? body : null;
  const existing = key ? pendingMutations.get(key)?.get(bodyKey) : undefined;
  if (existing) return existing as Promise<T>;
  const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  const emit = (phase: "start" | "end") => {
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("stockflow:action-request", { detail: { id, phase, method, endpoint } }));
  };
  emit("start");
  const request = performApiRequest<T>(endpoint, options).finally(() => {
    emit("end");
    if (key) {
      const group = pendingMutations.get(key);
      if (group?.get(bodyKey) === request) group.delete(bodyKey);
      if (group?.size === 0) pendingMutations.delete(key);
    }
  });
  if (key) {
    const group = pendingMutations.get(key) ?? new Map<string | null, Promise<unknown>>();
    group.set(bodyKey, request);
    pendingMutations.set(key, group);
  }
  return request;
}

async function performApiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers);

  headers.set("Accept", "application/json");

  if (
    options.body &&
    !(options.body instanceof FormData)
  ) {
    headers.set("Content-Type", "application/json");
  }

  const method = (
    options.method ?? "GET"
  ).toUpperCase();

  if (
    csrfToken &&
    !["GET", "HEAD", "OPTIONS"].includes(method)
  ) {
    headers.set("X-CSRF-Token", csrfToken);
  }

  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !headers.has('Idempotency-Key')) {
    const key = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    headers.set('Idempotency-Key', key);
  }

  let response: Response;
  try {
    response = await fetch(apiUrl(endpoint), {
      ...options,
      method,
      headers,
      credentials: "include",
      cache: "no-store",
    });
  } catch (reason) {
    const detail = reason instanceof Error ? reason.message : "Unknown network error";
    throw new ApiError(
      0,
      `Backend API tidak dapat diakses. Pastikan backend berjalan di ${normalizeApiUrl(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000")}. (${detail})`
    );
  }

  const text = await response.text();

  let result: T | null = null;

  try {
    result = text ? JSON.parse(text) as T : null;
  } catch {
    throw new Error(
      `Invalid JSON response from API (${response.status})`
    );
  }

  if (!response.ok) {
    if (response.status === 401) {
      setCsrfToken(null);
      unauthorizedHandler?.();
    }

    const message =
      typeof result === "object" &&
      result !== null &&
      "message" in result &&
      typeof result.message === "string"
        ? result.message
        : `Request failed (${response.status})`;

    const requestId = response.headers.get("X-Request-Id") ?? (typeof result === "object" && result !== null && "requestId" in result && typeof result.requestId === "string" ? result.requestId : undefined);
    throw new ApiError(response.status, userFacingMessage(message), requestId);
  }

  if (result === null) {
    throw new ApiError(
      response.status,
      "Empty or invalid server response"
    );
  }

  return result;
}

export async function apiDownload(endpoint: string): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(apiUrl(endpoint), {
      credentials: "include",
      cache: "no-store",
    });
  } catch (reason) {
    const detail = reason instanceof Error ? reason.message : "Unknown network error";
    throw new ApiError(0, `Backend API tidak dapat diakses. (${detail})`);
  }

  if (!response.ok) {
    const text = await response.text();
    let message = `Download failed (${response.status})`;
    try {
      const parsed = JSON.parse(text) as { message?: string };
      message = parsed.message ?? message;
    } catch {
      // Keep the HTTP fallback when the server did not return JSON.
    }
    throw new ApiError(response.status, message);
  }

  return response.blob();
}

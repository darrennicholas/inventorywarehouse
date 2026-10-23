
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

let csrfToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

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

export async function apiRequest<T>(
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
    throw new ApiError(response.status, message, requestId);
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

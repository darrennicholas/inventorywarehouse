
const API_URL = (
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:5000"
).replace(/\/$/, "");

let csrfToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
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

  const response = await fetch(
    endpoint.startsWith("/")
      ? `${API_URL}${endpoint}`
      : `${API_URL}/${endpoint}`,
    {
      ...options,
      method,
      headers,
      credentials: "include",
      cache: "no-store",
    }
  );

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

    throw new ApiError(response.status, message);
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
  const response = await fetch(
    endpoint.startsWith("/") ? `${API_URL}${endpoint}` : `${API_URL}/${endpoint}`,
    { credentials: "include", cache: "no-store" }
  );

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

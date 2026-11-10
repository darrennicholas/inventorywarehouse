type ErrorContext = {
  requestId?: string;
  method?: string;
  route?: string;
  userId?: string;
  job?: string;
};

export function reportError(error: unknown, context: ErrorContext = {}) {
  const record = typeof error === "object" && error !== null ? error as { name?: unknown; code?: unknown } : null;
  // Error messages/stacks can contain SQL, user supplied values, credentials,
  // and local filesystem paths. Keep production logs correlatable without
  // copying those values into the log sink.
  const normalized = {
    name: typeof record?.name === "string" ? record.name.slice(0, 80) : "UnknownError",
    ...(typeof record?.code === "string" && /^[A-Z0-9_]{1,24}$/.test(record.code) ? { code: record.code } : {}),
  };

  console.error(JSON.stringify({
    event: "api.error",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV ?? "development",
    ...Object.fromEntries(Object.entries(context).filter(([, value]) => typeof value === "string" && value.length <= 200)),
    error: normalized,
  }));
}

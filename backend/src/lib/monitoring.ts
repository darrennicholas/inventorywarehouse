type ErrorContext = {
  requestId?: string;
  method?: string;
  path?: string;
  userId?: string;
};

export function reportError(error: unknown, context: ErrorContext = {}) {
  const normalized = error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack }
    : { name: "UnknownError", message: String(error) };

  console.error(JSON.stringify({
    event: "api.error",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV ?? "development",
    ...context,
    error: normalized,
  }));
}


import express from "express";
import cors from "cors";
import helmet from "helmet";

import { env } from "./config/env.ts";
import apiRoutes from "./routes/index.ts";

import { notFoundHandler } from "./middlewares/notFound.middleware.ts";
import { errorHandler } from "./middlewares/error.middleware.ts";
import { requestId } from "./middlewares/request-id.middleware.ts";

const app = express();

app.use(requestId);

// ==========================================
// EXPRESS CONFIGURATION
// ==========================================

// Disable Express signature
app.disable("x-powered-by");

// ==========================================
// SECURITY HEADERS
// ==========================================

app.use(helmet());

// ==========================================
// CORS CONFIGURATION
// ==========================================

// Allow Next.js frontend to communicate
// with Express using session cookies.

app.use(
  cors({
    origin: env.FRONTEND_URL,

    // Required for HttpOnly session cookies
    credentials: true,

    methods: [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
    ],

    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-CSRF-Token",
      "Idempotency-Key",
    ],

    optionsSuccessStatus: 204,
  })
);

// ==========================================
// REQUEST BODY PARSING
// ==========================================

// Parse JSON request bodies
app.use(
  express.json({
    // Attachment uploads use a validated base64 payload; the route still
    // enforces a 10 MB binary limit after decoding.
    limit: "16mb",
  })
);

// Parse URL-encoded request bodies
app.use(
  express.urlencoded({
    extended: true,
    limit: "16mb",
  })
);

// ==========================================
// API ROUTES
// ==========================================

// All endpoints use /api prefix
app.use("/api", apiRoutes);

// ==========================================
// NOT FOUND HANDLER
// ==========================================

app.use(notFoundHandler);

// ==========================================
// GLOBAL ERROR HANDLER
// ==========================================

app.use(errorHandler);

// ==========================================
// EXPORT EXPRESS APPLICATION
// ==========================================

export default app;

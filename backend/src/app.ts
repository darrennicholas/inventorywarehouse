
import express from "express";
import cors from "cors";
import helmet from "helmet";

import { env } from "./config/env.ts";
import apiRoutes from "./routes/index.ts";

import { notFoundHandler } from "./middlewares/notFound.middleware.ts";
import { errorHandler } from "./middlewares/error.middleware.ts";

const app = express();

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
    limit: "1mb",
  })
);

// Parse URL-encoded request bodies
app.use(
  express.urlencoded({
    extended: true,
    limit: "1mb",
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

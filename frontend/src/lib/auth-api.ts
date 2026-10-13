
import { apiRequest } from "./api";

import type { ApiResponse } from "@/types/auth-api";

export {
  ApiError,
  registerUnauthorizedHandler,
  setCsrfToken,
} from "./api";

export type { ApiResponse } from "@/types/auth-api";

export function authApi<T>(
  path: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  return apiRequest<ApiResponse<T>>(path, options);
}

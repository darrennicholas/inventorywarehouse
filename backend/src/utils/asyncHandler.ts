
import type {
  Request,
  Response,
  NextFunction,
  RequestHandler,
} from "express";

type AsyncHandlerFunction = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<void>;

export function asyncHandler(
  handler: AsyncHandlerFunction
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(
      handler(req, res, next)
    ).catch(next);
  };
}

import { ORMError, ORMErrorReason } from "@zenstackhq/orm";

/** Stable machine-readable codes the web app can translate. */
export type ErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  /** 初回ログイン・再発行後: パスワード変更が必要 (§4.6) */
  | "PASSWORD_CHANGE_REQUIRED"
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVALID_STATE"
  | "UPSTREAM_ERROR"
  | "INTERNAL";

export class HttpError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(status: number, code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new HttpError(400, "INVALID_INPUT", message, details);
export const notFound = (message = "Not found") => new HttpError(404, "NOT_FOUND", message);
/** The request is valid but the record is not in a state that allows it (e.g. already assessed). */
export const invalidState = (message: string) => new HttpError(409, "INVALID_STATE", message);
export const forbidden = (message: string, details?: unknown) =>
  new HttpError(403, "FORBIDDEN", message, details);
/** Optimistic-lock mismatch or LY 409 (e.g. 査定結果が確定済み). */
export const conflict = (message: string, details?: unknown) =>
  new HttpError(409, "CONFLICT", message, details);
export const unauthorized = (message = "Sign in required") =>
  new HttpError(401, "UNAUTHORIZED", message);
export const tooManyRequests = (message = "Too many requests, slow down") =>
  new HttpError(429, "INVALID_STATE", message);
export const upstreamError = (message: string, details?: unknown) =>
  new HttpError(502, "UPSTREAM_ERROR", message, details);

const PG_UNIQUE_VIOLATION = "23505";
const PG_FK_VIOLATION = "23503";

/** Normalises any thrown value into the `{ error: { message, code } }` envelope + HTTP status. */
export function toErrorResponse(error: unknown): {
  status: number;
  body: { error: { message: string; code: ErrorCode; details?: unknown } };
} {
  if (error instanceof HttpError) {
    return {
      status: error.status,
      body: { error: { message: error.message, code: error.code, details: error.details } },
    };
  }

  if (error instanceof ORMError) {
    switch (error.reason) {
      case ORMErrorReason.INVALID_INPUT:
        return { status: 400, body: { error: { message: error.message, code: "INVALID_INPUT" } } };
      case ORMErrorReason.NOT_FOUND:
        return { status: 404, body: { error: { message: error.message, code: "NOT_FOUND" } } };
      case ORMErrorReason.REJECTED_BY_POLICY:
        return {
          status: 403,
          body: { error: { message: "Operation not permitted", code: "FORBIDDEN" } },
        };
      case ORMErrorReason.DB_QUERY_ERROR:
        if (error.dbErrorCode === PG_UNIQUE_VIOLATION) {
          return { status: 409, body: { error: { message: "Duplicate value", code: "CONFLICT" } } };
        }
        if (error.dbErrorCode === PG_FK_VIOLATION) {
          return {
            status: 409,
            body: { error: { message: "Record is referenced by other data", code: "CONFLICT" } },
          };
        }
        break;
    }
  }

  console.error(error);
  // Never leak internals (SQL, stack) to the client.
  return { status: 500, body: { error: { message: "Internal server error", code: "INTERNAL" } } };
}

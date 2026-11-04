import type { ErrorCode } from "./error-codes.ts";

export type Ref = { id: string; name: string };

export type ErrorDetails = {
  archived_id?: string;
  items?: Ref[];
  combos?: Ref[];
  categories?: Ref[];
  ids?: string[];
  suggested_price_cents?: number;
};

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details: ErrorDetails | undefined;

  constructor(
    statusCode: number,
    code: ErrorCode,
    message: string,
    details?: ErrorDetails,
  ) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class NotFoundError extends AppError {
  constructor(code: ErrorCode, message: string) {
    super(404, code, message);
  }
}

export class ConflictError extends AppError {
  constructor(code: ErrorCode, message: string, details?: ErrorDetails) {
    super(409, code, message, details);
  }
}

export class UnprocessableError extends AppError {
  constructor(code: ErrorCode, message: string, details?: ErrorDetails) {
    super(422, code, message, details);
  }
}

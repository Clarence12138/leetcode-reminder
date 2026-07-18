import { ZodError } from 'zod';

export class AppError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }
}

export interface PublicError {
  readonly code: string;
  readonly message: string;
}

export function toPublicError(error: unknown): PublicError {
  if (error instanceof AppError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof ZodError) {
    return { code: 'VALIDATION_ERROR', message: formatZodError(error) };
  }
  if (error instanceof Error) {
    return { code: 'INTERNAL_ERROR', message: error.message };
  }
  return { code: 'INTERNAL_ERROR', message: String(error) };
}

function formatZodError(error: ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '请求'}: ${issue.message}`)
    .join('；');
}

export class AppError extends Error {
  constructor(public status: number, public code: string, message?: string, public details?: unknown) {
    super(message ?? code);
  }
}
export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const forbidden = (msg = 'Forbidden') => new AppError(403, 'FORBIDDEN', msg);
export const conflict = (code: string, msg: string, details?: unknown) => new AppError(409, code, msg, details);
export const badRequest = (msg: string, details?: unknown) => new AppError(400, 'BAD_REQUEST', msg, details);

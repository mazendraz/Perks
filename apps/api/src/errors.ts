export class AppError extends Error {
  constructor(
    public code: string,
    public status = 400,
    public retryable = false,
    options?: ErrorOptions,
    /** Safe, schema-checked extra fields sent to the client (e.g. plan limit options). */
    public details?: Record<string, unknown>,
  ) {
    super(code, options);
  }
}
export function requireCondition(value: unknown, code: string, status = 400): asserts value {
  if (!value) throw new AppError(code, status);
}

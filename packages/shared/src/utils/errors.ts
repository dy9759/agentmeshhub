export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 400,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "AppError";
  }

  static notFound(message: string): AppError {
    return new AppError(message, 404, "NOT_FOUND");
  }

  static unauthorized(message: string = "Unauthorized"): AppError {
    return new AppError(message, 401, "UNAUTHORIZED");
  }

  static forbidden(message: string = "Forbidden"): AppError {
    return new AppError(message, 403, "FORBIDDEN");
  }

  static conflict(message: string): AppError {
    return new AppError(message, 409, "CONFLICT");
  }

  static badRequest(message: string): AppError {
    return new AppError(message, 400, "BAD_REQUEST");
  }
}

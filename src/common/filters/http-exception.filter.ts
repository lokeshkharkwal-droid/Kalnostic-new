import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { KaltrosException } from '../exceptions/kaltros.exception';
import { REQUEST_BODY_LIMIT_MB } from '../constants/request-limits.constant';

/** The error envelope all failures are rendered into. */
interface ErrorEnvelope {
  success: false;
  error: { code: string; message: string | string[] };
}

/**
 * Global exception filter — renders every thrown error as the standard
 * Kalnostics error envelope (CLAUDE.md rule #6):
 *
 * ```json
 * { "success": false, "error": { "code": "TENANT_NOT_FOUND", "message": "…" } }
 * ```
 *
 * - `KaltrosException` (and anything else already shaped that way) passes
 *   through unchanged, and its server-only `context` is logged.
 * - Other `HttpException`s (e.g. the `ValidationPipe`'s `BadRequestException`)
 *   are wrapped, preserving status + message(s).
 * - A request body over the size limit (the body parser throws a raw
 *   `entity.too.large` error before routing) becomes a clear 413, so the user
 *   is told to shorten the text instead of seeing a generic 500.
 * - Anything unknown becomes a clean 500 with its stack logged.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  /**
   * Format the caught exception and write the HTTP response.
   * @param exception the thrown value
   * @param host access to the underlying request/response
   */
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status = this.resolveStatus(exception);
    const body = this.resolveBody(exception);

    // Server errors are unexpected — log the stack + any KaltrosException context.
    if (status >= 500) {
      const context =
        exception instanceof KaltrosException ? exception.context : undefined;
      this.logger.error(
        `${request.method} ${request.url} ${JSON.stringify(context ?? {})}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json(body);
  }

  /** Determine the HTTP status code for any thrown value. */
  private resolveStatus(exception: unknown): number {
    if (exception instanceof HttpException) {
      return exception.getStatus();
    }
    if (this.isPayloadTooLarge(exception)) {
      return HttpStatus.PAYLOAD_TOO_LARGE;
    }
    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  /** Produce the `{ success:false, error:{code,message} }` body. */
  private resolveBody(exception: unknown): ErrorEnvelope {
    if (exception instanceof HttpException) {
      const res = exception.getResponse();

      // Already in our envelope shape (KaltrosException) — pass through.
      if (
        typeof res === 'object' &&
        res !== null &&
        'success' in res &&
        'error' in res
      ) {
        return res as ErrorEnvelope;
      }

      // Built-in HttpException (e.g. ValidationPipe) — wrap it.
      const code = this.codeForStatus(exception.getStatus());
      let message: string | string[] = exception.message;
      if (typeof res === 'object' && res !== null && 'message' in res) {
        message = (res as { message: string | string[] }).message;
      } else if (typeof res === 'string') {
        message = res;
      }
      return { success: false, error: { code, message } };
    }

    if (this.isPayloadTooLarge(exception)) {
      return {
        success: false,
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: `The data you sent is too large (the limit is ${REQUEST_BODY_LIMIT_MB} MB per request). Shorten the text, or remove pasted images, and try again.`,
        },
      };
    }

    return {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred.',
      },
    };
  }

  /**
   * Whether the body parser rejected the request for being over the size
   * limit. It throws a plain error (not an `HttpException`) tagged with
   * `type: 'entity.too.large'` and status 413.
   */
  private isPayloadTooLarge(exception: unknown): boolean {
    if (typeof exception !== 'object' || exception === null) return false;
    const e = exception as { type?: unknown; status?: unknown };
    return e.type === 'entity.too.large' || e.status === 413;
  }

  /** Map a status code to a default error code for non-Kaltros HttpExceptions. */
  private codeForStatus(status: number): string {
    const byStatus: Partial<Record<number, string>> = {
      [HttpStatus.BAD_REQUEST]: 'VALIDATION_ERROR',
      [HttpStatus.UNAUTHORIZED]: 'UNAUTHORISED',
      [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
      [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
      [HttpStatus.CONFLICT]: 'CONFLICT',
    };
    return byStatus[status] ?? 'HTTP_ERROR';
  }
}

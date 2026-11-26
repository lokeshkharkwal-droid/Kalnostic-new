import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { SubscriptionUpstreamError } from '../subscription.client';

/**
 * Renders a {@link SubscriptionUpstreamError} (thrown by the subscription server
 * client on a transport/HTTP failure) into the standard Kalnostics error envelope,
 * preserving the upstream code + message so the frontend can act on it.
 *
 * Without this, a `fetch` failure is a plain `Error` (not an `HttpException`), so
 * the global filter would turn it into an opaque `500 INTERNAL_ERROR`. A genuine
 * upstream server/transport failure (5xx, e.g. `SUBSCRIPTION_UNREACHABLE`) is
 * reported as `502 Bad Gateway` because the fault is in the subscription service,
 * not this request; client-side statuses (4xx/503) are surfaced verbatim.
 */
@Catch(SubscriptionUpstreamError)
export class SubscriptionUpstreamExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(
    SubscriptionUpstreamExceptionFilter.name,
  );

  catch(exception: SubscriptionUpstreamError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status =
      exception.status >= 500 ? HttpStatus.BAD_GATEWAY : exception.status;
    if (status >= 500) {
      this.logger.error(
        `subscription upstream ${exception.code}: ${exception.message}`,
      );
    }
    response.status(status).json({
      success: false,
      error: { code: exception.code, message: exception.message },
    });
  }
}

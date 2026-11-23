import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { InventoryUpstreamError } from '../inventory-consumption.client';

/**
 * Renders an {@link InventoryUpstreamError} (thrown by the inventory service
 * client) into the standard Kalnostics error envelope, preserving the upstream
 * error's code + message so the frontend can act on it.
 *
 * Without this, an upstream rejection is a plain `Error` (not an `HttpException`),
 * so the global filter turns it into an opaque `500 INTERNAL_ERROR` — hiding
 * actionable 4xx responses such as the `INVENTORY_ADJUSTMENT_SCOPE_MISMATCH`
 * 409 ("switch Inventory Settings back to Order Type to adjust it"). A client
 * error (4xx) is surfaced verbatim; a genuine upstream server/transport failure
 * (5xx, e.g. `INVENTORY_UNREACHABLE`) is reported as `502 Bad Gateway` because
 * the fault is in the inventory service, not this request.
 */
@Catch(InventoryUpstreamError)
export class InventoryUpstreamExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(InventoryUpstreamExceptionFilter.name);

  catch(exception: InventoryUpstreamError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status =
      exception.status >= 500 ? HttpStatus.BAD_GATEWAY : exception.status;
    if (status >= 500) {
      this.logger.error(
        `inventory upstream ${exception.code}: ${exception.message}`,
      );
    }
    response.status(status).json({
      success: false,
      error: { code: exception.code, message: exception.message },
    });
  }
}

import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/** Metadata block attached to every response. */
export interface ApiMeta {
  timestamp: string;
  total?: number;
  page?: number;
  limit?: number;
  totalPages?: number;
  [key: string]: unknown;
}

/** The success envelope produced for every request (CLAUDE.md rule #7). */
export interface ApiResponse<T> {
  success: true;
  data: T;
  meta: ApiMeta;
}

/**
 * Wraps every successful response in the standard `meta`-based envelope:
 *
 * ```json
 * { "success": true, "data": <data>, "meta": { "timestamp": "…" } }
 * ```
 *
 * When a controller returns an offset-paginated result
 * (`{ data, total, page, limit }`), the pagination fields are lifted into
 * `meta` (with a computed `totalPages`) so `data` is always just the items.
 */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  /**
   * Map the handler's return value into the response envelope.
   */
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((payload) => this.toEnvelope(payload)));
  }

  /**
   * Build the envelope, reshaping paginated payloads into `meta`.
   */
  private toEnvelope(payload: unknown): ApiResponse<unknown> {
    const timestamp = new Date().toISOString();

    if (payload === null || payload === undefined) {
      return { success: true, data: null, meta: { timestamp } };
    }

    if (this.isPaginated(payload)) {
      const { data, total, page, limit, ...rest } = payload;
      return {
        success: true,
        data,
        meta: {
          total,
          page,
          limit,
          totalPages: limit > 0 ? Math.ceil(total / limit) : 0,
          ...rest,
          timestamp,
        },
      };
    }

    return { success: true, data: payload, meta: { timestamp } };
  }

  /**
   * True when the payload is an offset-paginated result
   * (`data` array + numeric `total` + numeric `page`).
   */
  private isPaginated(
    payload: unknown,
  ): payload is { data: unknown[]; total: number; page: number; limit: number } {
    if (typeof payload !== 'object' || payload === null) {
      return false;
    }
    const obj = payload as Record<string, unknown>;
    return (
      Array.isArray(obj.data) &&
      typeof obj.total === 'number' &&
      typeof obj.page === 'number' &&
      typeof obj.limit === 'number'
    );
  }
}

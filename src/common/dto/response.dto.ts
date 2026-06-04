/**
 * Response envelope types (CLAUDE.md rule #7). The global `ResponseInterceptor`
 * builds these — controllers return raw data/DTOs and never construct them by
 * hand. These types exist for typing service/controller returns and tests.
 *
 * See `../interceptors/response.interceptor.ts` for the runtime shape.
 */

/** A list service's return shape; the interceptor lifts these into `meta`. */
export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Helper to build a `PaginatedResult` from items + a total count.
 * @param data the page of items
 * @param total total number of matching rows (across all pages)
 * @param page 1-based page number
 * @param limit page size
 */
export function paginated<T>(
  data: T[],
  total: number,
  page: number,
  limit: number,
): PaginatedResult<T> {
  return { data, total, page, limit };
}

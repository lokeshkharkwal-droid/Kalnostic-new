/**
 * Largest JSON / form request body the API accepts, in megabytes.
 *
 * Express's default (100 KB) is too small for legitimate rich-text payloads
 * (a long Overall Result or Notes section pasted from Word/Excel), so it is
 * raised here. Used by `main.ts` (the body parsers) and by the global
 * exception filter (the "too large" message), so the two can never disagree.
 */
export const REQUEST_BODY_LIMIT_MB = 5;

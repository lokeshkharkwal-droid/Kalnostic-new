import { Request } from 'express';

/**
 * Best-effort extraction of the originating client IP from an Express request.
 *
 * Order of precedence:
 *  1. the first hop in `x-forwarded-for` (set by reverse proxies / load balancers)
 *  2. the `x-real-ip` header (common nginx convention)
 *  3. the raw socket remote address
 *
 * Returns `null` when none are available. The app does not enable Express
 * `trust proxy`, so we read the forwarded headers manually rather than `req.ip`.
 *
 * @param req the incoming Express request
 * @returns the client IP, or `null` if it cannot be determined
 */
export function extractClientIp(req: Request): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  const forwardedValue = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const firstForwarded = forwardedValue?.split(',')[0]?.trim();
  if (firstForwarded) {
    return firstForwarded;
  }

  const realIp = req.headers['x-real-ip'];
  const realIpValue = Array.isArray(realIp) ? realIp[0] : realIp;
  if (realIpValue) {
    return realIpValue.trim();
  }

  return req.socket?.remoteAddress ?? null;
}

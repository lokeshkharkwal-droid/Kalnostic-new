import { SetMetadata } from '@nestjs/common';

/** Metadata key the global JwtAuthGuard checks to skip authentication. */
export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route (or controller) as public — the global `JwtAuthGuard` lets it
 * through without a valid business JWT (e.g. login, refresh).
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

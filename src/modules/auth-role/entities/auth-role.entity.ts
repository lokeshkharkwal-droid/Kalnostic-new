import { AuthRole } from '@prisma/client';

/** Domain/response shape for a role (the Prisma model is the DB source of truth). */
export type AuthRoleEntity = AuthRole;

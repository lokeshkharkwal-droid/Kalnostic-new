import { UserBranchPermission } from '@prisma/client';

/** Domain/response shape for a per-(user+branch) permission grant. */
export type UserBranchPermissionEntity = UserBranchPermission;

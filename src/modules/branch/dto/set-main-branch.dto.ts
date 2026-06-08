import { IsUUID } from 'class-validator';

/**
 * Body for setting a tenant's main branch. `branchId` is one of the few places
 * a branch id legitimately arrives from the client (the caller is *choosing*
 * which branch is main); the service validates it belongs to the caller's
 * tenant before persisting (CLAUDE.md §4.7).
 */
export class SetMainBranchDto {
  @IsUUID()
  branchId: string;
}

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Resolves the set of departments a staff user belongs to and turns it into a
 * reusable "department visibility" filter fragment. This is the read-only,
 * dependency-light counterpart to `UsersService.getDepartmentAssignments` (no
 * membership check, no default resolution) so cross-cutting listing services
 * (Accession, Lab Report) can scope their queries by the caller's departments
 * without importing the heavy `UsersService`.
 *
 * The visibility rule (per CLAUDE.md §4.7 — enforced server-side, applied before
 * pagination/counts) is: a row is visible when its department is NULL (unassigned
 * → everyone) OR one of the caller's mapped departments. A user with no mapping
 * therefore sees only unassigned rows.
 */
@Injectable()
export class UserDepartmentScopeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The department ids a staff user is assigned to: reads the dedicated
   * `UserDepartmentAssignment` table (membership — "which departments does
   * this user belong to", NOT the signatory `DepartmentPersonMapping` table).
   * Tenant-level only (no branch column on this model), so every assignment
   * applies regardless of which branch the caller is currently working at.
   * @param tenantId tenant scope (from JWT)
   * @param personId the calling user
   * @returns the user's department ids (empty when the user has no assignment)
   */
  async resolveDepartmentIds(
    tenantId: string,
    personId: string,
  ): Promise<string[]> {
    const rows = await this.prisma.userDepartmentAssignment.findMany({
      where: {
        tenantId,
        personId,
        deletedAt: null,
      },
      select: { departmentId: true },
    });
    return [...new Set(rows.map((r) => r.departmentId))];
  }
}

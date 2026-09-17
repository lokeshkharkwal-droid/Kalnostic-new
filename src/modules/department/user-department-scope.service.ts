import { Injectable } from '@nestjs/common';
import { PersonMappingType } from '@prisma/client';
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
   * The tenant-wide department ids a staff user is assigned to (reads the shared
   * `DepartmentPersonMapping` rows with `type = USER`, `branchId = null`).
   * @param tenantId tenant scope (from JWT)
   * @param personId the calling user
   * @returns the user's department ids (empty when the user has no mapping)
   */
  async resolveDepartmentIds(
    tenantId: string,
    personId: string,
  ): Promise<string[]> {
    const rows = await this.prisma.departmentPersonMapping.findMany({
      where: {
        tenantId,
        personId,
        type: PersonMappingType.USER,
        branchId: null,
        deletedAt: null,
      },
      select: { departmentId: true },
    });
    return rows.map((r) => r.departmentId);
  }
}

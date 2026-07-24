import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { InvalidSalespersonException } from './exceptions/sales-trip.exceptions';

/**
 * Shared helper for the Sales domain: validates that a person is a salesperson
 * (any active staff member of the tenant, in this phase) and resolves person ids
 * to display names. Exported by the trip module and injected by the lead and
 * follow-up modules so the "who is the salesperson" concept lives in one place
 * (CLAUDE.md §10 — extract & inject, don't duplicate).
 */
@Injectable()
export class SalesStaffService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Assert that `personId` is an active staff member of the tenant. Any staff
   * Person qualifies as a salesperson in this phase (a specific sales-role gate
   * is deferred — see Master/SALES-MODULE-PLAN.md).
   * @throws InvalidSalespersonException if the person is not active staff
   */
  async assertSalesperson(tenantId: string, personId: string): Promise<void> {
    const membership = await this.prisma.tenantStaffMembership.findFirst({
      where: { tenantId, personId, deletedAt: null },
      select: { id: true },
    });
    if (!membership) {
      throw new InvalidSalespersonException(personId);
    }
  }

  /**
   * Resolve a set of person ids to a `{ id → displayName }` map. Unknown ids are
   * simply absent from the map. Person is platform-level, so this read is not
   * tenant-scoped.
   * @param personIds the ids to resolve (duplicates/empties are tolerated)
   */
  async resolveNames(personIds: string[]): Promise<Map<string, string>> {
    const ids = [...new Set(personIds.filter((id): id is string => !!id))];
    if (ids.length === 0) return new Map();
    const persons = await this.prisma.person.findMany({
      where: { id: { in: ids } },
      select: { id: true, firstName: true, middleName: true, lastName: true },
    });
    return new Map(
      persons.map((p) => [
        p.id,
        [p.firstName, p.middleName, p.lastName]
          .filter((s): s is string => !!s && s.trim().length > 0)
          .join(' '),
      ]),
    );
  }

  /**
   * Resolve a single person id to a display name (or null when absent/unknown).
   */
  async resolveName(personId?: string | null): Promise<string | null> {
    if (!personId) return null;
    const map = await this.resolveNames([personId]);
    return map.get(personId) ?? null;
  }
}

import { Injectable } from '@nestjs/common';
import { PhlebotomistScheduleStatus, StaffStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { BranchService } from '../branch/branch.service';
import { PhlebotomistDirectoryService } from './phlebotomist-directory.service';
import {
  ListSchedulePhlebotomistsDto,
  PhlebotomistListSortBy,
} from './dto/list-schedule-phlebotomists.dto';
import {
  PhlebotomistCurrentStatus,
  PhlebotomistListRow,
} from './entities/phlebotomist-schedule.entity';
import { maskMobile } from './utils/schedule-time.util';

/** Per-person service zones resolved from the active schedule. */
interface PersonZones {
  names: string[];
  ids: Set<string>;
}

/** A fully enriched list row (before pagination/serial numbering). */
interface EnrichedRow {
  phlebotomistId: string;
  name: string;
  branch: string | null;
  zone: string | null;
  zoneIds: Set<string>;
  mobile: string | null;
  email: string | null;
  assignedVisits: number;
  completedVisits: number;
  phlebotomyCount: number;
  currentStatus: PhlebotomistCurrentStatus;
}

/**
 * Phlebotomist List (Tab 1) read model. Lists the active branch's phlebotomists
 * (staff Persons holding the `phlebotomist` role) enriched with **dynamically
 * computed** visit counts (from `OrderDiagnostics` → `Order.appointment`) and a
 * live current status. Tenant-scoped + branch-level (CLAUDE.md §4.7): every query
 * carries `tenantId`/`branchId` and filters soft-deleted rows.
 *
 * Counts and current status aren't stored columns, so the branch's phlebotomist
 * set is loaded, enriched, filtered, sorted, and paginated in memory — correct
 * for the modest per-branch phlebotomist count.
 */
@Injectable()
export class PhlebotomistListService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly directory: PhlebotomistDirectoryService,
    private readonly branchService: BranchService,
  ) {}

  /**
   * List the branch's phlebotomists with visit counts and current status.
   * @param tenantId tenant scope
   * @param branchId active branch
   * @param query pagination + `search`/`zoneId`/`status` filters + `sortBy`/`sortOrder`
   */
  async list(
    tenantId: string,
    branchId: string,
    query: ListSchedulePhlebotomistsDto,
  ): Promise<PaginatedResult<PhlebotomistListRow>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const profiles = await this.directory.branchProfiles(tenantId, branchId);
    const personIds = profiles.map((p) => p.personId);

    const [
      persons,
      zonesByPerson,
      assigned,
      completed,
      total,
      onRoute,
      branch,
    ] = await Promise.all([
      this.directory.personsByIds(personIds),
      this.zonesByPerson(tenantId, branchId, personIds),
      this.directory.countVisits(tenantId, branchId, personIds, 'assigned'),
      this.directory.countVisits(tenantId, branchId, personIds, 'completed'),
      this.directory.countVisits(tenantId, branchId, personIds, 'total'),
      this.onRouteToday(tenantId, branchId, personIds),
      this.branchService.findById(branchId, tenantId),
    ]);

    const enriched: EnrichedRow[] = [];
    for (const profile of profiles) {
      const person = persons.get(profile.personId);
      if (!person) continue; // inactive/soft-deleted person
      const zones = zonesByPerson.get(profile.personId);
      enriched.push({
        phlebotomistId: profile.personId,
        name: [person.firstName, person.lastName].filter(Boolean).join(' '),
        branch: branch.name,
        zone: zones && zones.names.length > 0 ? zones.names.join(', ') : null,
        zoneIds: zones?.ids ?? new Set(),
        mobile: maskMobile(person.phone),
        email: person.email,
        assignedVisits: assigned.get(profile.personId) ?? 0,
        completedVisits: completed.get(profile.personId) ?? 0,
        phlebotomyCount: total.get(profile.personId) ?? 0,
        currentStatus: this.currentStatus(
          profile.branchStatus,
          onRoute.has(profile.personId),
        ),
      });
    }

    const filtered = this.filter(enriched, query);
    this.sort(filtered, query.sortBy, query.sortOrder ?? 'asc');

    const totalRows = filtered.length;
    const start = (page - 1) * limit;
    const pageRows = filtered.slice(start, start + limit);
    const data: PhlebotomistListRow[] = pageRows.map((r, i) => ({
      srNo: start + i + 1,
      phlebotomistId: r.phlebotomistId,
      name: r.name,
      branch: r.branch,
      zone: r.zone,
      mobile: r.mobile,
      email: r.email,
      assignedVisits: r.assignedVisits,
      completedVisits: r.completedVisits,
      phlebotomyCount: r.phlebotomyCount,
      currentStatus: r.currentStatus,
    }));

    return { data, total: totalRows, page, limit };
  }

  /** Active-schedule service zones per phlebotomist (names + ids). */
  private async zonesByPerson(
    tenantId: string,
    branchId: string,
    personIds: string[],
  ): Promise<Map<string, PersonZones>> {
    const result = new Map<string, PersonZones>();
    if (personIds.length === 0) return result;
    const schedules = await this.prisma.phlebotomistSchedule.findMany({
      where: {
        tenantId,
        branchId,
        phlebotomistId: { in: personIds },
        status: PhlebotomistScheduleStatus.ACTIVE,
        deletedAt: null,
      },
      select: {
        phlebotomistId: true,
        zones: {
          where: { deletedAt: null },
          select: { zoneId: true, zone: { select: { name: true } } },
        },
      },
    });
    for (const s of schedules) {
      result.set(s.phlebotomistId, {
        names: s.zones.map((z) => z.zone.name),
        ids: new Set(s.zones.map((z) => z.zoneId)),
      });
    }
    return result;
  }

  /** Person ids on route today (drives the "On Route" status). */
  private async onRouteToday(
    tenantId: string,
    branchId: string,
    personIds: string[],
  ): Promise<Set<string>> {
    const today = new Date();
    const start = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
    );
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return this.directory.onRoutePersonIds(
      tenantId,
      branchId,
      personIds,
      start,
      end,
    );
  }

  /** Apply the search / zone / status filters. */
  private filter(
    rows: EnrichedRow[],
    query: ListSchedulePhlebotomistsDto,
  ): EnrichedRow[] {
    const term = query.search?.trim().toLowerCase();
    return rows.filter((r) => {
      if (term && !r.name.toLowerCase().includes(term)) return false;
      if (query.zoneId && !r.zoneIds.has(query.zoneId)) return false;
      if (query.status && r.currentStatus !== query.status) return false;
      return true;
    });
  }

  /** Sort enriched rows in place by the requested column (default: name asc). */
  private sort(
    rows: EnrichedRow[],
    sortBy: PhlebotomistListSortBy | undefined,
    order: 'asc' | 'desc',
  ): void {
    const key = sortBy ?? 'name';
    const dir = order === 'desc' ? -1 : 1;
    rows.sort((a, b) => this.compare(a, b, key) * dir);
  }

  /** Compare two rows by a sort column. */
  private compare(
    a: EnrichedRow,
    b: EnrichedRow,
    key: PhlebotomistListSortBy,
  ): number {
    switch (key) {
      case 'assignedVisits':
        return a.assignedVisits - b.assignedVisits;
      case 'completedVisits':
        return a.completedVisits - b.completedVisits;
      case 'phlebotomyCount':
        return a.phlebotomyCount - b.phlebotomyCount;
      case 'branch':
        return this.cmpStr(a.branch, b.branch);
      case 'zone':
        return this.cmpStr(a.zone, b.zone);
      case 'currentStatus':
        return this.cmpStr(a.currentStatus, b.currentStatus);
      case 'name':
      default:
        return this.cmpStr(a.name, b.name);
    }
  }

  /** Case-insensitive string compare, nulls last. */
  private cmpStr(a: string | null, b: string | null): number {
    if (a === b) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return a.localeCompare(b, undefined, { sensitivity: 'base' });
  }

  /** Map per-branch staff status + on-route flag to the live status label. */
  private currentStatus(
    branchStatus: StaffStatus,
    onRoute: boolean,
  ): PhlebotomistCurrentStatus {
    if (branchStatus !== StaffStatus.ACTIVE) return 'Inactive';
    return onRoute ? 'On Route' : 'Available';
  }
}

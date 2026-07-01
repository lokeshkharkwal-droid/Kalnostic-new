import { Injectable } from '@nestjs/common';
import { DataSource, Prisma, TestGroup } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { ValidationException } from '../../common/exceptions/kaltros.exception';
import { CreateTestGroupDto } from './dto/create-test-group.dto';
import { UpdateTestGroupDto } from './dto/update-test-group.dto';
import { ListTestGroupsDto } from './dto/list-test-groups.dto';
import {
  TestGroupLabTest,
  TestGroupListRow,
  TestGroupWithTests,
} from './entities/test-group.entity';
import {
  TestGroupLabTestNotFoundException,
  TestGroupNameConflictException,
  TestGroupNotFoundException,
} from './exceptions/test-group.exceptions';

/**
 * Test-group management (SiteAdmin only). A test group is a named bundle of
 * SITE_ADMIN lab-test templates, mapped many-to-many via `TestGroupMapping`.
 * Platform-level (CLAUDE.md §4.2) — no tenant scoping, so writes run through the
 * plain Prisma client (no `withTenant`). Every mapped `labTestId` is validated to
 * reference an active SITE_ADMIN template lab test; the DB enforces at-most-once
 * mapping and unique active group names (partial unique indexes in prisma/rls.sql).
 */
@Injectable()
export class TestGroupService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a test group and its lab-test mappings in one transaction.
   * @param actorId the SiteAdmin creating the group (actor trail)
   * @param dto validated payload (`groupName` + optional `labTestIds`)
   * @returns the created group with its mapped lab tests
   * @throws ValidationException on duplicate ids in `labTestIds`
   * @throws TestGroupLabTestNotFoundException if a lab test ref is invalid
   * @throws TestGroupNameConflictException if the name is already taken
   */
  async create(
    actorId: string,
    dto: CreateTestGroupDto,
  ): Promise<TestGroupWithTests> {
    const labTestIds = dto.labTestIds ?? [];
    await this.assertLabTestRefs(labTestIds);
    let createdId: string;
    try {
      createdId = await this.prisma.$transaction(async (tx) => {
        const group = await tx.testGroup.create({
          data: {
            groupName: dto.groupName,
            createdBy: actorId,
            updatedBy: actorId,
          },
        });
        await this.createMappings(tx, group.id, labTestIds);
        return group.id;
      });
    } catch (e) {
      this.rethrowConflict(e, dto.groupName);
      throw e;
    }
    return this.findById(createdId);
  }

  /**
   * List active test groups for the listing screen: search by `groupName` and
   * paginate. Each row carries the count of active mapped lab tests.
   * @param query search + pagination
   */
  async findAll(
    query: ListTestGroupsDto,
  ): Promise<PaginatedResult<TestGroupListRow>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.TestGroupWhereInput = { deletedAt: null };
    const search = query.search?.trim();
    if (search) {
      where.groupName = { contains: search, mode: 'insensitive' };
    }

    const [groups, total] = await Promise.all([
      this.prisma.testGroup.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.testGroup.count({ where }),
    ]);

    const counts = await this.countMappingsByGroup(groups.map((g) => g.id));
    const data: TestGroupListRow[] = groups.map((g) => ({
      id: g.id,
      groupName: g.groupName,
      labTestsCount: counts.get(g.id) ?? 0,
    }));
    return { data, total, page, limit };
  }

  /**
   * Fetch one test group composed with its mapped lab tests (in mapping order).
   * @param id test group id
   * @throws TestGroupNotFoundException if missing or soft-deleted
   */
  async findById(id: string): Promise<TestGroupWithTests> {
    const group = await this.findCoreById(id);
    const mappings = await this.prisma.testGroupMapping.findMany({
      where: { testGroupId: id, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    const labTests = await this.resolveLabTests(
      mappings.map((m) => m.labTestId),
    );
    return { ...group, labTests };
  }

  /**
   * Update a test group. `groupName` is patched when provided; when `labTestIds`
   * is provided the whole mapping set is replaced (old active mappings
   * soft-deleted, the new set created) in one transaction.
   * @param id test group id
   * @param actorId the SiteAdmin performing the update (actor trail)
   * @param dto partial update
   * @throws TestGroupNotFoundException if missing/soft-deleted
   * @throws ValidationException on duplicate ids in `labTestIds`
   * @throws TestGroupLabTestNotFoundException if a lab test ref is invalid
   * @throws TestGroupNameConflictException if the name is already taken
   */
  async update(
    id: string,
    actorId: string,
    dto: UpdateTestGroupDto,
  ): Promise<TestGroupWithTests> {
    await this.findCoreById(id);
    if (dto.labTestIds !== undefined) {
      await this.assertLabTestRefs(dto.labTestIds);
    }

    const data: Prisma.TestGroupUpdateInput = { updatedBy: actorId };
    if (dto.groupName !== undefined) {
      data.groupName = dto.groupName;
    }

    const now = new Date();
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.testGroup.update({ where: { id }, data });
        if (dto.labTestIds !== undefined) {
          await tx.testGroupMapping.updateMany({
            where: { testGroupId: id, deletedAt: null },
            data: { deletedAt: now },
          });
          await this.createMappings(tx, id, dto.labTestIds);
        }
      });
    } catch (e) {
      this.rethrowConflict(e, dto.groupName ?? '');
      throw e;
    }
    return this.findById(id);
  }

  /**
   * Soft-delete a test group and cascade soft-delete all its mappings, in one
   * transaction.
   * @param id test group id
   * @throws TestGroupNotFoundException if missing/soft-deleted
   */
  async remove(id: string): Promise<TestGroup> {
    await this.findCoreById(id);
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      await tx.testGroupMapping.updateMany({
        where: { testGroupId: id, deletedAt: null },
        data: { deletedAt: now },
      });
      return tx.testGroup.update({ where: { id }, data: { deletedAt: now } });
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  /**
   * Fetch one active test group (core row only).
   * @throws TestGroupNotFoundException if missing or soft-deleted
   */
  private async findCoreById(id: string): Promise<TestGroup> {
    const group = await this.prisma.testGroup.findFirst({
      where: { id, deletedAt: null },
    });
    if (!group) {
      throw new TestGroupNotFoundException(id);
    }
    return group;
  }

  /**
   * Validate that every id references an active SITE_ADMIN lab-test template, with
   * no duplicates within the request.
   * @throws ValidationException on duplicate ids
   * @throws TestGroupLabTestNotFoundException on missing/non-template ids
   */
  private async assertLabTestRefs(labTestIds: string[]): Promise<void> {
    if (!labTestIds.length) {
      return;
    }
    const unique = new Set(labTestIds);
    if (unique.size !== labTestIds.length) {
      throw new ValidationException('Duplicate lab test references');
    }
    const found = await this.prisma.labTest.findMany({
      where: {
        id: { in: [...unique] },
        source: DataSource.SITE_ADMIN,
        tenantId: null,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (found.length !== unique.size) {
      const foundIds = new Set(found.map((t) => t.id));
      const missing = [...unique].filter((id) => !foundIds.has(id));
      throw new TestGroupLabTestNotFoundException(missing);
    }
  }

  /** Insert a group's lab-test mappings (no-op for an empty list). */
  private async createMappings(
    tx: Prisma.TransactionClient,
    testGroupId: string,
    labTestIds: string[],
  ): Promise<void> {
    if (!labTestIds.length) {
      return;
    }
    await tx.testGroupMapping.createMany({
      data: labTestIds.map((labTestId) => ({ testGroupId, labTestId })),
    });
  }

  /**
   * Resolve a set of lab-test ids to their `{ id, testName, testCode }`
   * projections, preserving the input order and dropping any that no longer exist.
   */
  private async resolveLabTests(
    labTestIds: string[],
  ): Promise<TestGroupLabTest[]> {
    if (!labTestIds.length) {
      return [];
    }
    const rows = await this.prisma.labTest.findMany({
      where: { id: { in: labTestIds } },
      select: { id: true, testName: true, testCode: true },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return labTestIds
      .map((id) => byId.get(id))
      .filter((r): r is TestGroupLabTest => Boolean(r));
  }

  /** Count active mappings per group, keyed by `testGroupId`. */
  private async countMappingsByGroup(
    ids: string[],
  ): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (!ids.length) {
      return map;
    }
    const grouped = await this.prisma.testGroupMapping.groupBy({
      by: ['testGroupId'],
      where: { testGroupId: { in: ids }, deletedAt: null },
      _count: { _all: true },
    });
    for (const g of grouped) {
      map.set(g.testGroupId, g._count._all);
    }
    return map;
  }

  /**
   * Map a Prisma unique-constraint violation (P2002) on the group name to the
   * typed 409; rethrow anything else.
   */
  private rethrowConflict(e: unknown, groupName: string): void {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      throw new TestGroupNameConflictException(groupName);
    }
  }
}

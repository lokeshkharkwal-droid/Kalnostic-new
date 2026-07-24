import { Injectable } from '@nestjs/common';
import { DataSource, Equipment, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { ValidationException } from '../../common/exceptions/kaltros.exception';
import { CreateEquipmentDto } from './dto/create-equipment.dto';
import { UpdateEquipmentDto } from './dto/update-equipment.dto';
import { ListEquipmentDto } from './dto/list-equipment.dto';
import {
  EquipmentLabTest,
  EquipmentListRow,
  EquipmentWithTests,
} from './entities/equipment.entity';
import {
  EquipmentLabTestNotFoundException,
  EquipmentNameConflictException,
  EquipmentNotFoundException,
} from './exceptions/equipment.exceptions';

/** A lightweight equipment option row for business selectors. */
export interface EquipmentOption {
  id: string;
  name: string;
  code: string | null;
}

/**
 * Lab-equipment management (SiteAdmin only). An equipment is a global catalogue
 * entry carrying an adapter code, a description, three rich-text HTML documents,
 * and the set of SITE_ADMIN lab-test templates it processes, mapped
 * many-to-many via `EquipmentLabTest`. Platform-level (CLAUDE.md §4.2) — no
 * tenant scoping, so writes run through the plain Prisma client (no
 * `withTenant`). Every mapped `labTestId` is validated to reference an active
 * SITE_ADMIN template lab test; the DB enforces at-most-once mapping and unique
 * active equipment names (partial unique indexes in prisma/rls.sql).
 */
@Injectable()
export class EquipmentService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create an equipment and its lab-test mappings in one transaction.
   * @param actorId the SiteAdmin creating the equipment (actor trail)
   * @param dto validated payload (identity/documents + optional `labTestIds`)
   * @returns the created equipment with its mapped lab tests
   * @throws ValidationException on duplicate ids in `labTestIds`
   * @throws EquipmentLabTestNotFoundException if a lab test ref is invalid
   * @throws EquipmentNameConflictException if the name is already taken
   */
  async create(
    actorId: string,
    dto: CreateEquipmentDto,
  ): Promise<EquipmentWithTests> {
    const labTestIds = dto.labTestIds ?? [];
    await this.assertLabTestRefs(labTestIds);
    let createdId: string;
    try {
      createdId = await this.prisma.$transaction(async (tx) => {
        const equipment = await tx.equipment.create({
          data: {
            name: dto.name,
            code: dto.code ?? null,
            description: dto.description ?? null,
            setupDocument: dto.setupDocument ?? null,
            labConfigDocument: dto.labConfigDocument ?? null,
            adopterDocument: dto.adopterDocument ?? null,
            createdBy: actorId,
            updatedBy: actorId,
          },
        });
        await this.createMappings(tx, equipment.id, labTestIds);
        return equipment.id;
      });
    } catch (e) {
      this.rethrowConflict(e, dto.name);
      throw e;
    }
    return this.findById(createdId);
  }

  /**
   * List active equipment for the listing screen: search by `name` and paginate.
   * Each row carries the count of active mapped lab tests.
   * @param query search + pagination
   */
  async findAll(
    query: ListEquipmentDto,
  ): Promise<PaginatedResult<EquipmentListRow>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.EquipmentWhereInput = { deletedAt: null };
    const search = query.search?.trim();
    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }

    const [equipment, total] = await Promise.all([
      this.prisma.equipment.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { name: 'asc' },
      }),
      this.prisma.equipment.count({ where }),
    ]);

    const counts = await this.countMappingsByEquipment(
      equipment.map((e) => e.id),
    );
    const data: EquipmentListRow[] = equipment.map((e) => ({
      id: e.id,
      name: e.name,
      code: e.code,
      labTestsCount: counts.get(e.id) ?? 0,
    }));
    return { data, total, page, limit };
  }

  /**
   * Lightweight `{ id, name, code }` options for business selectors (the Lab
   * Adapter form's Equipment picker). Returns active global equipment, optionally
   * filtered by a case-insensitive `search` on the name.
   * @param filters optional search + offset pagination
   * @returns the full option array when `page` is omitted, else a paginated envelope
   */
  async findOptions(
    filters: { search?: string; page?: number; limit?: number } = {},
  ): Promise<EquipmentOption[] | PaginatedResult<EquipmentOption>> {
    const where: Prisma.EquipmentWhereInput = { deletedAt: null };
    const term = filters.search?.trim();
    if (term) {
      where.name = { contains: term, mode: 'insensitive' };
    }

    const select = { id: true, name: true, code: true } as const;
    const orderBy = { name: 'asc' } as const;

    if (filters.page === undefined) {
      return this.prisma.equipment.findMany({ where, select, orderBy });
    }

    const page = filters.page;
    const limit = filters.limit ?? 20;
    const [data, total] = await Promise.all([
      this.prisma.equipment.findMany({
        where,
        select,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.equipment.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  /**
   * Fetch one equipment composed with its mapped lab tests (in mapping order).
   * @param id equipment id
   * @throws EquipmentNotFoundException if missing or soft-deleted
   */
  async findById(id: string): Promise<EquipmentWithTests> {
    const equipment = await this.findCoreById(id);
    const mappings = await this.prisma.equipmentLabTest.findMany({
      where: { equipmentId: id, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    const labTests = await this.resolveLabTests(
      mappings.map((m) => m.labTestId),
    );
    return { ...equipment, labTests };
  }

  /**
   * Update an equipment. Provided scalar fields are patched; when `labTestIds` is
   * provided the whole mapping set is replaced (old active mappings soft-deleted,
   * the new set created) in one transaction.
   * @param id equipment id
   * @param actorId the SiteAdmin performing the update (actor trail)
   * @param dto partial update
   * @throws EquipmentNotFoundException if missing/soft-deleted
   * @throws ValidationException on duplicate ids in `labTestIds`
   * @throws EquipmentLabTestNotFoundException if a lab test ref is invalid
   * @throws EquipmentNameConflictException if the name is already taken
   */
  async update(
    id: string,
    actorId: string,
    dto: UpdateEquipmentDto,
  ): Promise<EquipmentWithTests> {
    await this.findCoreById(id);
    if (dto.labTestIds !== undefined) {
      await this.assertLabTestRefs(dto.labTestIds);
    }

    const data: Prisma.EquipmentUpdateInput = { updatedBy: actorId };
    if (dto.name !== undefined) {
      data.name = dto.name;
    }
    if (dto.code !== undefined) {
      data.code = dto.code;
    }
    if (dto.description !== undefined) {
      data.description = dto.description;
    }
    if (dto.setupDocument !== undefined) {
      data.setupDocument = dto.setupDocument;
    }
    if (dto.labConfigDocument !== undefined) {
      data.labConfigDocument = dto.labConfigDocument;
    }
    if (dto.adopterDocument !== undefined) {
      data.adopterDocument = dto.adopterDocument;
    }

    const now = new Date();
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.equipment.update({ where: { id }, data });
        if (dto.labTestIds !== undefined) {
          await tx.equipmentLabTest.updateMany({
            where: { equipmentId: id, deletedAt: null },
            data: { deletedAt: now },
          });
          await this.createMappings(tx, id, dto.labTestIds);
        }
      });
    } catch (e) {
      this.rethrowConflict(e, dto.name ?? '');
      throw e;
    }
    return this.findById(id);
  }

  /**
   * Soft-delete an equipment and cascade soft-delete all its mappings, in one
   * transaction.
   * @param id equipment id
   * @throws EquipmentNotFoundException if missing/soft-deleted
   */
  async remove(id: string): Promise<Equipment> {
    await this.findCoreById(id);
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      await tx.equipmentLabTest.updateMany({
        where: { equipmentId: id, deletedAt: null },
        data: { deletedAt: now },
      });
      return tx.equipment.update({ where: { id }, data: { deletedAt: now } });
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  /**
   * Fetch one active equipment (core row only).
   * @throws EquipmentNotFoundException if missing or soft-deleted
   */
  private async findCoreById(id: string): Promise<Equipment> {
    const equipment = await this.prisma.equipment.findFirst({
      where: { id, deletedAt: null },
    });
    if (!equipment) {
      throw new EquipmentNotFoundException(id);
    }
    return equipment;
  }

  /**
   * Validate that every id references an active SITE_ADMIN lab-test template, with
   * no duplicates within the request.
   * @throws ValidationException on duplicate ids
   * @throws EquipmentLabTestNotFoundException on missing/non-template ids
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
      throw new EquipmentLabTestNotFoundException(missing);
    }
  }

  /** Insert an equipment's lab-test mappings (no-op for an empty list). */
  private async createMappings(
    tx: Prisma.TransactionClient,
    equipmentId: string,
    labTestIds: string[],
  ): Promise<void> {
    if (!labTestIds.length) {
      return;
    }
    await tx.equipmentLabTest.createMany({
      data: labTestIds.map((labTestId) => ({ equipmentId, labTestId })),
    });
  }

  /**
   * Resolve a set of lab-test ids to their `{ id, testName, testCode }`
   * projections, preserving the input order and dropping any that no longer exist.
   */
  private async resolveLabTests(
    labTestIds: string[],
  ): Promise<EquipmentLabTest[]> {
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
      .filter((r): r is EquipmentLabTest => Boolean(r));
  }

  /** Count active mappings per equipment, keyed by `equipmentId`. */
  private async countMappingsByEquipment(
    ids: string[],
  ): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (!ids.length) {
      return map;
    }
    const grouped = await this.prisma.equipmentLabTest.groupBy({
      by: ['equipmentId'],
      where: { equipmentId: { in: ids }, deletedAt: null },
      _count: { _all: true },
    });
    for (const g of grouped) {
      map.set(g.equipmentId, g._count._all);
    }
    return map;
  }

  /**
   * Map a Prisma unique-constraint violation (P2002) on the equipment name to the
   * typed 409; rethrow anything else.
   */
  private rethrowConflict(e: unknown, name: string): void {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      throw new EquipmentNameConflictException(name);
    }
  }
}

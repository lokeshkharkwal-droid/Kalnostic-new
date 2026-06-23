import { Injectable } from '@nestjs/common';
import { Machine, MachineAdapterLog, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { ValidationException } from '../../common/exceptions/kaltros.exception';
import { BranchService } from '../branch/branch.service';
import { DepartmentService } from '../department/department.service';
import { CreateMachineDto } from './dto/create-machine.dto';
import { UpdateMachineDto } from './dto/update-machine.dto';
import { ListMachinesDto } from './dto/list-machines.dto';
import { CreateAdapterLogDto } from './dto/create-adapter-log.dto';
import { MachineReagentKitDto } from './dto/machine-reagent-kit.dto';
import { MachineTestMappingDto } from './dto/machine-test-mapping.dto';
import { MachineWithChildren } from './entities/machine.entity';
import {
  MachineAdapterLogNotFoundException,
  MachineCodeConflictException,
  MachineNotFoundException,
} from './exceptions/machine.exceptions';

/** Scalar fields of a machine (the DTO minus its nested children/branch ids). */
type MachineScalars = Omit<
  CreateMachineDto,
  'reagentKits' | 'testMappings' | 'branchIds'
>;

/**
 * Machine Management. Tenant-scoped, tenant-level (CLAUDE.md §4.6): a machine is
 * owned by the business and assigned to branches via `MachineBranch`. Every query
 * carries `tenantId` (defence in depth on top of RLS, §4.3) and filters
 * soft-deleted rows. Multi-step writes run in `withTenant` transactions; the
 * referenced department and branches are validated via their owning services
 * (rule #3 — DI, not direct file imports).
 */
@Injectable()
export class MachineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly departmentService: DepartmentService,
    private readonly branchService: BranchService,
  ) {}

  /**
   * Create a machine with its reagent kits, test mappings, and branch
   * assignments. The `departmentId` (if given) and every `branchIds` entry are
   * validated to belong to the caller's tenant before any write. All inserts run
   * in one transaction.
   * @param tenantId owning tenant (from context)
   * @param dto validated payload (no `tenantId`)
   * @returns the created machine composed with its children + branch mappings
   * @throws DepartmentNotFoundException if `departmentId` is missing/other tenant
   * @throws BranchNotFoundException if any `branchIds` entry is missing/other tenant
   * @throws ValidationException on duplicate branch ids in the payload
   * @throws MachineCodeConflictException if the code is already used in the tenant
   */
  async create(
    tenantId: string,
    dto: CreateMachineDto,
  ): Promise<MachineWithChildren> {
    const { reagentKits, testMappings, branchIds, ...scalars } = dto;
    await this.assertReferences(tenantId, dto.departmentId, branchIds);

    let createdId: string;
    try {
      createdId = await this.prisma.withTenant(tenantId, async (tx) => {
        const machine = await tx.machine.create({
          data: { ...this.toCreateData(scalars), tenantId },
        });
        await this.createReagentKits(tx, tenantId, machine.id, reagentKits);
        await this.createTestMappings(tx, tenantId, machine.id, testMappings);
        await this.createBranchLinks(tx, tenantId, machine.id, branchIds);
        return machine.id;
      });
    } catch (e) {
      this.rethrowConflict(e, dto.code);
      throw e;
    }
    return this.findById(createdId, tenantId);
  }

  /**
   * Fetch one machine composed with its reagent kits, test mappings, and active
   * branch assignments.
   * @param id machine id
   * @param tenantId tenant scope
   * @throws MachineNotFoundException if missing or soft-deleted
   */
  async findById(id: string, tenantId: string): Promise<MachineWithChildren> {
    const machine = await this.findCoreById(id, tenantId);
    const [withChildren] = await this.attachChildren(tenantId, [machine]);
    // attachChildren preserves order and length, so [0] always exists here.
    return withChildren!;
  }

  /**
   * List active machines for a tenant (offset pagination), each composed with its
   * reagent kits, test mappings, and active branch assignments. Optional search +
   * status + department filters.
   * @param tenantId tenant scope
   * @param query search/filter + pagination
   */
  async findAll(
    tenantId: string,
    query: ListMachinesDto,
  ): Promise<PaginatedResult<MachineWithChildren>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.MachineWhereInput = { tenantId, deletedAt: null };
    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { machineName: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
        { serialNo: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (query.status) where.status = query.status;
    if (query.departmentId) where.departmentId = query.departmentId;

    const [machines, total] = await Promise.all([
      this.prisma.machine.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.machine.count({ where }),
    ]);
    const data = await this.attachChildren(tenantId, machines);
    return { data, total, page, limit };
  }

  /**
   * Update a machine. Core fields are patched; when `reagentKits`/`testMappings`/
   * `branchIds` are provided, the whole corresponding set is replaced (old active
   * rows soft-deleted, the new set created) in one transaction.
   * @param id machine id
   * @param tenantId tenant scope
   * @param dto partial update
   * @throws MachineNotFoundException if missing/soft-deleted
   * @throws DepartmentNotFoundException / BranchNotFoundException on bad references
   * @throws MachineCodeConflictException if the new code collides
   */
  async update(
    id: string,
    tenantId: string,
    dto: UpdateMachineDto,
  ): Promise<MachineWithChildren> {
    await this.findCoreById(id, tenantId);
    const { reagentKits, testMappings, branchIds, ...scalars } = dto;
    await this.assertReferences(tenantId, dto.departmentId, branchIds);

    const now = new Date();
    try {
      await this.prisma.withTenant(tenantId, async (tx) => {
        await tx.machine.update({
          where: { id },
          data: this.toUpdateData(scalars),
        });

        if (reagentKits !== undefined) {
          await tx.machineReagentKit.updateMany({
            where: { machineId: id, tenantId, deletedAt: null },
            data: { deletedAt: now },
          });
          await this.createReagentKits(tx, tenantId, id, reagentKits);
        }
        if (testMappings !== undefined) {
          await tx.machineTestMapping.updateMany({
            where: { machineId: id, tenantId, deletedAt: null },
            data: { deletedAt: now },
          });
          await this.createTestMappings(tx, tenantId, id, testMappings);
        }
        if (branchIds !== undefined) {
          await tx.machineBranch.updateMany({
            where: { machineId: id, tenantId, deletedAt: null },
            data: { deletedAt: now },
          });
          await this.createBranchLinks(tx, tenantId, id, branchIds);
        }
      });
    } catch (e) {
      this.rethrowConflict(e, dto.code);
      throw e;
    }
    return this.findById(id, tenantId);
  }

  /**
   * Soft-delete a machine and cascade soft-delete its reagent kits, test
   * mappings, adapter logs, and branch assignments in one transaction.
   * @param id machine id
   * @param tenantId tenant scope
   * @throws MachineNotFoundException if missing/soft-deleted
   */
  async remove(id: string, tenantId: string): Promise<Machine> {
    await this.findCoreById(id, tenantId);
    const now = new Date();
    return this.prisma.withTenant(tenantId, async (tx) => {
      const where = { machineId: id, tenantId, deletedAt: null };
      await tx.machineReagentKit.updateMany({
        where,
        data: { deletedAt: now },
      });
      await tx.machineTestMapping.updateMany({
        where,
        data: { deletedAt: now },
      });
      await tx.machineAdapterLog.updateMany({
        where,
        data: { deletedAt: now },
      });
      await tx.machineBranch.updateMany({ where, data: { deletedAt: now } });
      return tx.machine.update({ where: { id }, data: { deletedAt: now } });
    });
  }

  // ── Adapter logs ──────────────────────────────────────────────────────────────

  /**
   * List a machine's adapter communication logs (newest first, offset
   * pagination). Append-only — logs are never edited.
   * @param machineId machine id
   * @param tenantId tenant scope
   * @param page 1-based page (default 1)
   * @param limit page size (default 20)
   * @throws MachineNotFoundException if the machine is missing/soft-deleted
   */
  async listAdapterLogs(
    machineId: string,
    tenantId: string,
    page = 1,
    limit = 20,
  ): Promise<PaginatedResult<MachineAdapterLog>> {
    await this.findCoreById(machineId, tenantId);
    const where = { machineId, tenantId, deletedAt: null };
    const [data, total] = await Promise.all([
      this.prisma.machineAdapterLog.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.machineAdapterLog.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  /**
   * Append an adapter communication log line for a machine.
   * @param machineId machine id
   * @param tenantId tenant scope
   * @param dto the log payload
   * @throws MachineNotFoundException if the machine is missing/soft-deleted
   */
  async appendAdapterLog(
    machineId: string,
    tenantId: string,
    dto: CreateAdapterLogDto,
  ): Promise<MachineAdapterLog> {
    await this.findCoreById(machineId, tenantId);
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.machineAdapterLog.create({
        data: {
          tenantId,
          machineId,
          logType: dto.logType ?? null,
          status: dto.status ?? null,
          sourceIp: dto.sourceIp ?? null,
        },
      }),
    );
  }

  /**
   * Mark an adapter log line as viewed.
   * @param machineId machine id
   * @param logId adapter log id
   * @param tenantId tenant scope
   * @throws MachineNotFoundException if the machine is missing/soft-deleted
   * @throws MachineAdapterLogNotFoundException if the log is missing/other machine
   */
  async markLogViewed(
    machineId: string,
    logId: string,
    tenantId: string,
  ): Promise<MachineAdapterLog> {
    await this.findCoreById(machineId, tenantId);
    const log = await this.prisma.machineAdapterLog.findFirst({
      where: { id: logId, machineId, tenantId, deletedAt: null },
    });
    if (!log) {
      throw new MachineAdapterLogNotFoundException(logId);
    }
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.machineAdapterLog.update({
        where: { id: logId },
        data: { isViewed: true },
      }),
    );
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────────

  /**
   * Fetch one active machine (core row only) scoped to its tenant.
   * @throws MachineNotFoundException if missing/soft-deleted
   */
  private async findCoreById(id: string, tenantId: string): Promise<Machine> {
    const machine = await this.prisma.machine.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!machine) {
      throw new MachineNotFoundException(id);
    }
    return machine;
  }

  /**
   * Compose a set of machines with their active reagent kits, test mappings, and
   * branch assignments. Children are batch-loaded over the page's machine ids and
   * grouped in memory (no N+1). Order/length of `machines` is preserved.
   */
  private async attachChildren(
    tenantId: string,
    machines: Machine[],
  ): Promise<MachineWithChildren[]> {
    if (machines.length === 0) {
      return [];
    }
    const machineIds = machines.map((m) => m.id);
    const where = { machineId: { in: machineIds }, tenantId, deletedAt: null };
    const orderBy = { createdAt: 'asc' as const };
    const [kits, mappings, branches] = await Promise.all([
      this.prisma.machineReagentKit.findMany({ where, orderBy }),
      this.prisma.machineTestMapping.findMany({ where, orderBy }),
      this.prisma.machineBranch.findMany({ where, orderBy }),
    ]);
    const kitsByMachine = this.groupByMachine(kits);
    const mappingsByMachine = this.groupByMachine(mappings);
    const branchesByMachine = this.groupByMachine(branches);
    return machines.map((m) => ({
      ...m,
      reagentKits: kitsByMachine.get(m.id) ?? [],
      testMappings: mappingsByMachine.get(m.id) ?? [],
      branches: branchesByMachine.get(m.id) ?? [],
    }));
  }

  /** Group rows carrying a `machineId` into an `id → rows[]` map. */
  private groupByMachine<T extends { machineId: string }>(
    rows: T[],
  ): Map<string, T[]> {
    const map = new Map<string, T[]>();
    for (const row of rows) {
      const list = map.get(row.machineId);
      if (list) {
        list.push(row);
      } else {
        map.set(row.machineId, [row]);
      }
    }
    return map;
  }

  /**
   * Validate that the referenced department (if any) and every branch id belong
   * to the caller's tenant. Branch ids must be unique within the payload.
   * @throws DepartmentNotFoundException / BranchNotFoundException on bad references
   * @throws ValidationException on duplicate branch ids
   */
  private async assertReferences(
    tenantId: string,
    departmentId: string | undefined,
    branchIds: string[] | undefined,
  ): Promise<void> {
    if (departmentId) {
      // Throws DepartmentNotFoundException if missing / other tenant.
      await this.departmentService.findById(departmentId, tenantId);
    }
    if (branchIds && branchIds.length > 0) {
      const unique = new Set(branchIds);
      if (unique.size !== branchIds.length) {
        throw new ValidationException('Duplicate branch ids in payload');
      }
      // Throws BranchNotFoundException on the first missing / other-tenant branch.
      for (const branchId of unique) {
        await this.branchService.findById(branchId, tenantId);
      }
    }
  }

  /** Insert a machine's reagent kit rows (no-op for an empty/absent list). */
  private async createReagentKits(
    tx: Prisma.TransactionClient,
    tenantId: string,
    machineId: string,
    kits: MachineReagentKitDto[] | undefined,
  ): Promise<void> {
    if (!kits?.length) {
      return;
    }
    await tx.machineReagentKit.createMany({
      data: kits.map((k) => ({ ...k, tenantId, machineId })),
    });
  }

  /** Insert a machine's test mapping rows (no-op for an empty/absent list). */
  private async createTestMappings(
    tx: Prisma.TransactionClient,
    tenantId: string,
    machineId: string,
    mappings: MachineTestMappingDto[] | undefined,
  ): Promise<void> {
    if (!mappings?.length) {
      return;
    }
    await tx.machineTestMapping.createMany({
      data: mappings.map((m) => ({ ...m, tenantId, machineId })),
    });
  }

  /** Insert a machine's branch-assignment rows (no-op for an empty/absent list). */
  private async createBranchLinks(
    tx: Prisma.TransactionClient,
    tenantId: string,
    machineId: string,
    branchIds: string[] | undefined,
  ): Promise<void> {
    if (!branchIds?.length) {
      return;
    }
    await tx.machineBranch.createMany({
      data: branchIds.map((branchId) => ({ tenantId, machineId, branchId })),
    });
  }

  /** Build the Prisma create payload, coercing date strings to `Date`. */
  private toCreateData(scalars: MachineScalars): Prisma.MachineCreateInput {
    return {
      ...scalars,
      ...this.dateFields(scalars),
    } as Prisma.MachineCreateInput;
  }

  /** Build the Prisma update payload, coercing any provided date strings to `Date`. */
  private toUpdateData(
    scalars: Partial<MachineScalars>,
  ): Prisma.MachineUpdateInput {
    return {
      ...scalars,
      ...this.dateFields(scalars),
    };
  }

  /**
   * Convert the four ISO date-string fields to `Date` where present. Returns only
   * the keys that are defined so a partial update never clears an absent field.
   */
  private dateFields(
    scalars: Partial<MachineScalars>,
  ): Record<string, Date | undefined> {
    const out: Record<string, Date | undefined> = {};
    if (scalars.lastCalibrationDate !== undefined) {
      out.lastCalibrationDate = new Date(scalars.lastCalibrationDate);
    }
    if (scalars.lastMaintenanceDate !== undefined) {
      out.lastMaintenanceDate = new Date(scalars.lastMaintenanceDate);
    }
    if (scalars.nextCalibrationDate !== undefined) {
      out.nextCalibrationDate = new Date(scalars.nextCalibrationDate);
    }
    if (scalars.nextMaintenanceDue !== undefined) {
      out.nextMaintenanceDue = new Date(scalars.nextMaintenanceDue);
    }
    return out;
  }

  /**
   * Map a Prisma unique-constraint violation (P2002) on the machine code to the
   * typed 409. Other violations pass through.
   */
  private rethrowConflict(e: unknown, code: string | undefined): void {
    if (
      !(e instanceof Prisma.PrismaClientKnownRequestError) ||
      e.code !== 'P2002'
    ) {
      return;
    }
    throw new MachineCodeConflictException(code ?? '');
  }
}

import { Injectable } from '@nestjs/common';
import { Prisma, RadiologyCertificate } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MasterDataService } from '../master-data/master-data.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { CreateRadiologyCertificateDto } from './dto/create-radiology-certificate.dto';
import { UpdateRadiologyCertificateDto } from './dto/update-radiology-certificate.dto';
import { ListRadiologyCertificatesDto } from './dto/list-radiology-certificates.dto';
import { RadiologyCertificateOptionsQueryDto } from './dto/radiology-certificate-options-query.dto';
import { RadiologyCertificateOption } from './entities/radiology-certificate.entity';
import {
  RadiologyCertificateNameConflictException,
  RadiologyCertificateNotFoundException,
} from './exceptions/radiology-certificate.exceptions';

/**
 * Radiology Certificate service. CRUD for the `rad_medical_certificate`-style
 * certificate templates authored under a master data (tenant-scoped +
 * branch-level). Ported from EzHealthTrack `radiologyCertificateCreate`. There is
 * deliberately NO SiteAdmin import/sync/clone path — certificates are authored per
 * tenant/branch only. All writes run inside `withTenant` transactions and the
 * master data is validated to belong to the caller's tenant (which also supplies
 * `branchId`).
 */
@Injectable()
export class RadiologyCertificateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly masterDataService: MasterDataService,
  ) {}

  /**
   * Create a radiology certificate in a master data.
   * @param masterDataId parent master data (validated against the tenant)
   * @param tenantId tenant scope (from JWT)
   * @param actorId acting person id (created_by/updated_by)
   * @param dto validated payload
   * @returns the created certificate
   * @throws RadiologyCertificateNameConflictException on a duplicate active name
   */
  async create(
    masterDataId: string,
    tenantId: string,
    actorId: string | null,
    dto: CreateRadiologyCertificateDto,
  ): Promise<RadiologyCertificate> {
    const masterData = await this.masterDataService.findById(
      masterDataId,
      tenantId,
    );
    try {
      return await this.prisma.withTenant(tenantId, (tx) =>
        tx.radiologyCertificate.create({
          data: {
            tenantId,
            branchId: masterData.branchId,
            masterDataId,
            name: dto.name,
            groupName: dto.groupName,
            content: dto.content ?? null,
            isActive: dto.isActive ?? true,
            createdBy: actorId,
            updatedBy: actorId,
          },
        }),
      );
    } catch (e) {
      this.rethrowConflict(e, dto.name);
      throw e;
    }
  }

  /**
   * List a master data's radiology certificates (paginated, full rows), newest
   * first. Supports `search` (name/group), `groupName`, and `isActive` filters.
   */
  async findAll(
    masterDataId: string,
    tenantId: string,
    query: ListRadiologyCertificatesDto = {},
  ): Promise<PaginatedResult<RadiologyCertificate>> {
    await this.masterDataService.findById(masterDataId, tenantId);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.RadiologyCertificateWhereInput = {
      masterDataId,
      tenantId,
      deletedAt: null,
      ...(query.groupName ? { groupName: query.groupName } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
    };
    const term = query.search?.trim();
    if (term) {
      where.OR = [
        { name: { contains: term, mode: 'insensitive' } },
        { groupName: { contains: term, mode: 'insensitive' } },
      ];
    }
    const [data, total] = await Promise.all([
      this.prisma.radiologyCertificate.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.radiologyCertificate.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  /**
   * Fetch one certificate scoped to its master data + tenant.
   * @throws RadiologyCertificateNotFoundException
   */
  async findById(
    masterDataId: string,
    id: string,
    tenantId: string,
  ): Promise<RadiologyCertificate> {
    await this.masterDataService.findById(masterDataId, tenantId);
    const row = await this.prisma.radiologyCertificate.findFirst({
      where: { id, masterDataId, tenantId, deletedAt: null },
    });
    if (!row) {
      throw new RadiologyCertificateNotFoundException(id);
    }
    return row;
  }

  /**
   * Update a certificate's scalar fields.
   * @throws RadiologyCertificateNotFoundException / RadiologyCertificateNameConflictException
   */
  async update(
    masterDataId: string,
    id: string,
    tenantId: string,
    actorId: string | null,
    dto: UpdateRadiologyCertificateDto,
  ): Promise<RadiologyCertificate> {
    await this.findById(masterDataId, id, tenantId);
    try {
      return await this.prisma.withTenant(tenantId, (tx) =>
        tx.radiologyCertificate.update({
          where: { id },
          data: {
            ...(dto.name !== undefined ? { name: dto.name } : {}),
            ...(dto.groupName !== undefined
              ? { groupName: dto.groupName }
              : {}),
            ...(dto.content !== undefined ? { content: dto.content } : {}),
            ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
            updatedBy: actorId,
          },
        }),
      );
    } catch (e) {
      this.rethrowConflict(e, dto.name ?? '');
      throw e;
    }
  }

  /**
   * Soft-delete a certificate (sets `deletedAt`).
   * @throws RadiologyCertificateNotFoundException
   */
  async remove(
    masterDataId: string,
    id: string,
    tenantId: string,
    actorId: string | null,
  ): Promise<{ id: string }> {
    await this.findById(masterDataId, id, tenantId);
    await this.prisma.withTenant(tenantId, (tx) =>
      tx.radiologyCertificate.update({
        where: { id },
        data: { deletedAt: new Date(), updatedBy: actorId },
      }),
    );
    return { id };
  }

  /**
   * Trimmed `{ id, name, groupName }` options for the active branch's certificates
   * (optionally narrowed to a master data / search). Used by pickers.
   */
  async findOptions(
    tenantId: string,
    branchId: string | null,
    query: RadiologyCertificateOptionsQueryDto,
  ): Promise<RadiologyCertificateOption[]> {
    const where: Prisma.RadiologyCertificateWhereInput = {
      tenantId,
      deletedAt: null,
      isActive: true,
      // Certificates are TENANT-wide (EzHealthTrack `getAllCertBuss` scopes by
      // business, not branch): a branch user sees both tenant-level (branchId
      // null) templates AND their own branch's. A tenant-level admin (no active
      // branch) sees all.
      ...(branchId ? { OR: [{ branchId }, { branchId: null }] } : {}),
      ...(query.masterDataId ? { masterDataId: query.masterDataId } : {}),
    };
    const term = query.search?.trim();
    if (term) {
      where.name = { contains: term, mode: 'insensitive' };
    }
    const rows = await this.prisma.radiologyCertificate.findMany({
      where,
      select: { id: true, name: true, groupName: true },
      orderBy: { name: 'asc' },
      take: 50,
    });
    return rows;
  }

  /** Map a Prisma unique-violation (active name per master data) to a 409. */
  private rethrowConflict(e: unknown, name: string): void {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      throw new RadiologyCertificateNameConflictException(name);
    }
  }
}

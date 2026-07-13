import { Injectable } from '@nestjs/common';
import { Prisma, DocumentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { CategoryService } from '../category/category.service';
import { DepartmentService } from '../department/department.service';
import { BranchService } from '../branch/branch.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { ListDocumentsQueryDto } from './dto/list-documents-query.dto';
import {
  DOCUMENT_INCLUDE,
  DocumentVersionEntity,
  DocumentWithRelations,
} from './entities/document.entity';
import {
  DocumentNotFoundException,
  DocumentNumberConflictException,
  DocumentVersionConflictException,
  DocumentVersionNotFoundException,
  InvalidDocumentAuthorException,
} from './exceptions/document.exceptions';

/** The full set of editable, snapshotted document fields. */
interface DocumentSnapshotFields {
  documentNumber: string;
  documentType: DocumentWithRelations['documentType'];
  title: string;
  categoryId: string | null;
  departmentId: string | null;
  authorId: string | null;
  approvedById: string | null;
  status: DocumentWithRelations['status'];
  effectiveDate: Date | null;
  expiryDate: Date | null;
  reviewDate: Date | null;
  fileName: string | null;
  fileUrl: string | null;
  description: string | null;
}

/** Coerce an optional ISO date string into a `Date` (or null when absent). */
function toNullableDate(value?: string | null): Date | null {
  return value ? new Date(value) : null;
}

/**
 * Document management. Tenant-scoped + branch-level (CLAUDE.md §4.6). Every query
 * carries `tenantId` + `branchId` (defence in depth on top of RLS, §4.3) and
 * filters soft-deleted rows. The `Document` row is the current/active version;
 * an immutable snapshot of every version is preserved in `DocumentVersion`, which
 * is never updated or deleted. Catalogue + author references are validated via
 * the exported services / staff lookup (never a direct cross-module file import,
 * rule #3).
 */
@Injectable()
export class DocumentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categoryService: CategoryService,
    private readonly departmentService: DepartmentService,
    private readonly branchService: BranchService,
  ) {}

  /**
   * Build the base `where` for a document query, scoped to the tenant, active
   * (non-soft-deleted) rows, and — when `branchId` is supplied — a single
   * branch. A supplied `branchId` is verified to belong to the tenant first
   * (§4.5); absent → all branches of the tenant. This is the single place that
   * decides branch scope for reads.
   * @throws BranchNotFoundException if `branchId` is not a branch of the tenant
   */
  private async scopedWhere(
    tenantId: string,
    branchId?: string,
  ): Promise<Prisma.DocumentWhereInput> {
    if (branchId) {
      await this.branchService.findById(branchId, tenantId);
    }
    return {
      tenantId,
      deletedAt: null,
      ...(branchId ? { branchId } : {}),
    };
  }

  /**
   * Create a document and seed version 1 of its history (one transaction).
   * @param tenantId owning tenant (from context)
   * @param branchId owning branch (active branch from the JWT) — `null` for a
   *   tenant-level document created by a Business Admin (no active branch)
   * @param dto validated document payload
   * @param actorId person id of the creator (recorded on the version)
   * @returns the created document with its catalogue relations
   * @throws DocumentNumberConflictException if the number is taken in the scope
   */
  async create(
    tenantId: string,
    branchId: string | null,
    dto: CreateDocumentDto,
    actorId: string,
  ): Promise<DocumentWithRelations> {
    await this.validateRefs(tenantId, dto);
    await this.assertNumberAvailable(tenantId, branchId, dto.documentNumber);

    const snapshot: DocumentSnapshotFields = {
      documentNumber: dto.documentNumber,
      documentType: dto.documentType,
      title: dto.title,
      categoryId: dto.categoryId ?? null,
      departmentId: dto.departmentId ?? null,
      authorId: dto.authorId ?? null,
      approvedById: dto.approvedById ?? null,
      status: dto.status ?? 'DRAFT',
      effectiveDate: toNullableDate(dto.effectiveDate),
      expiryDate: toNullableDate(dto.expiryDate),
      reviewDate: toNullableDate(dto.reviewDate),
      fileName: dto.fileName ?? null,
      fileUrl: dto.fileUrl ?? null,
      description: dto.description ?? null,
    };

    return this.prisma.withTenant(tenantId, async (tx) => {
      const doc = await tx.document.create({
        data: {
          tenantId,
          branchId,
          ...snapshot,
          version: dto.version,
          latestVersionNo: 1,
          createdBy: actorId,
          updatedBy: actorId,
        },
        include: DOCUMENT_INCLUDE,
      });
      await tx.documentVersion.create({
        data: {
          tenantId,
          branchId,
          documentId: doc.id,
          versionNo: 1,
          version: dto.version,
          ...snapshot,
          changedBy: actorId,
        },
      });
      return doc;
    });
  }

  /**
   * Fetch one active document scoped to its tenant (and branch when supplied).
   * @param branchId optional branch scope — omit for a tenant-wide lookup
   *   (Business Admin views a document that may live in any branch)
   * @throws DocumentNotFoundException if missing or soft-deleted
   * @throws BranchNotFoundException if `branchId` is not a branch of the tenant
   */
  async findById(
    id: string,
    tenantId: string,
    branchId?: string,
  ): Promise<DocumentWithRelations> {
    const doc = await this.prisma.document.findFirst({
      where: { id, ...(await this.scopedWhere(tenantId, branchId)) },
      include: DOCUMENT_INCLUDE,
    });
    if (!doc) {
      throw new DocumentNotFoundException(id);
    }
    return doc;
  }

  /**
   * List active documents (offset pagination), newest first. Scope is decided by
   * `query.branchId`: present → that branch only (verified against the tenant);
   * absent → all branches of the tenant (Business Admin). Optional filters:
   * case-insensitive `search` (matches `documentNumber` or `title`), status,
   * document type, category, department.
   * @throws BranchNotFoundException if `query.branchId` is not a tenant branch
   */
  async findAll(
    tenantId: string,
    query: ListDocumentsQueryDto,
  ): Promise<PaginatedResult<DocumentWithRelations>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.DocumentWhereInput = {
      ...(await this.scopedWhere(tenantId, query.branchId)),
      ...(query.status ? { status: query.status } : {}),
      ...(query.documentType ? { documentType: query.documentType } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
    };
    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { documentNumber: { contains: search, mode: 'insensitive' } },
        { title: { contains: search, mode: 'insensitive' } },
      ];
    }
    const data = await this.prisma.document.findMany({
      where,
      include: DOCUMENT_INCLUDE,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
    const total = await this.prisma.document.count({ where });
    return { data, total, page, limit };
  }

  /**
   * Exact document count per status for the caller's scope, computed in the
   * database (one `count` per status in a single transaction — the parallel-count
   * pattern used by `TenantService.getDashboardCounts`). Every `DocumentStatus`
   * key is always present (0 when none). Scope follows `branchId`: present → that
   * branch (verified); absent → all branches of the tenant. Counts describe the
   * full status distribution and are **not** narrowed by list filters.
   * @throws BranchNotFoundException if `branchId` is not a branch of the tenant
   */
  async getStatusSummary(
    tenantId: string,
    branchId?: string,
  ): Promise<Record<DocumentStatus, number>> {
    const base = await this.scopedWhere(tenantId, branchId);
    const statuses = Object.values(DocumentStatus);
    const counts = await this.prisma.$transaction(
      statuses.map((status) =>
        this.prisma.document.count({ where: { ...base, status } }),
      ),
    );
    return statuses.reduce(
      (acc, status, i) => {
        acc[status] = counts[i] ?? 0;
        return acc;
      },
      {} as Record<DocumentStatus, number>,
    );
  }

  /**
   * Edit a document. **Every edit creates a new preserved version**: the current
   * row is updated in place and a fresh immutable snapshot (next `versionNo`) is
   * appended; all earlier snapshots are untouched. The new `version` string must
   * be unique within the document.
   * @throws DocumentVersionConflictException if `version` is already used
   * @throws DocumentNumberConflictException if a changed number collides
   */
  async update(
    id: string,
    tenantId: string,
    branchId: string | null,
    dto: UpdateDocumentDto,
    actorId: string,
  ): Promise<DocumentWithRelations> {
    const current = await this.findById(id, tenantId, branchId ?? undefined);
    await this.validateRefs(tenantId, dto);

    // The version string must introduce a new, unique value for this document.
    const versionTaken = await this.prisma.documentVersion.findFirst({
      where: { documentId: id, version: dto.version },
      select: { id: true },
    });
    if (versionTaken) {
      throw new DocumentVersionConflictException(dto.version);
    }

    if (
      dto.documentNumber !== undefined &&
      dto.documentNumber !== current.documentNumber
    ) {
      // Uniqueness is checked in the document's own scope, not the caller's —
      // a Business Admin (branchId null) may edit a branch-level document.
      await this.assertNumberAvailable(
        tenantId,
        current.branchId,
        dto.documentNumber,
        id,
      );
    }

    const next: DocumentSnapshotFields = {
      documentNumber: dto.documentNumber ?? current.documentNumber,
      documentType: dto.documentType ?? current.documentType,
      title: dto.title ?? current.title,
      categoryId:
        dto.categoryId !== undefined ? dto.categoryId : current.categoryId,
      departmentId:
        dto.departmentId !== undefined
          ? dto.departmentId
          : current.departmentId,
      authorId: dto.authorId !== undefined ? dto.authorId : current.authorId,
      approvedById:
        dto.approvedById !== undefined
          ? dto.approvedById
          : current.approvedById,
      status: dto.status ?? current.status,
      effectiveDate:
        dto.effectiveDate !== undefined
          ? toNullableDate(dto.effectiveDate)
          : current.effectiveDate,
      expiryDate:
        dto.expiryDate !== undefined
          ? toNullableDate(dto.expiryDate)
          : current.expiryDate,
      reviewDate:
        dto.reviewDate !== undefined
          ? toNullableDate(dto.reviewDate)
          : current.reviewDate,
      fileName: dto.fileName !== undefined ? dto.fileName : current.fileName,
      fileUrl: dto.fileUrl !== undefined ? dto.fileUrl : current.fileUrl,
      description:
        dto.description !== undefined ? dto.description : current.description,
    };
    const nextNo = current.latestVersionNo + 1;

    return this.prisma.withTenant(tenantId, async (tx) => {
      const updated = await tx.document.update({
        where: { id },
        data: {
          ...next,
          version: dto.version,
          latestVersionNo: nextNo,
          updatedBy: actorId,
        },
        include: DOCUMENT_INCLUDE,
      });
      await tx.documentVersion.create({
        data: {
          tenantId,
          // Mirror the document's own branch so the row and its version stay
          // consistent regardless of the caller's active branch.
          branchId: current.branchId,
          documentId: id,
          versionNo: nextNo,
          version: dto.version,
          ...next,
          changedBy: actorId,
        },
      });
      return updated;
    });
  }

  /**
   * Soft-delete a document (sets `deletedAt`; version snapshots are preserved).
   */
  async remove(
    id: string,
    tenantId: string,
    branchId: string | null,
    actorId: string,
  ): Promise<DocumentWithRelations> {
    await this.findById(id, tenantId, branchId ?? undefined);
    return this.prisma.withTenant(tenantId, async (tx) => {
      return tx.document.update({
        where: { id },
        data: { deletedAt: new Date(), updatedBy: actorId },
        include: DOCUMENT_INCLUDE,
      });
    });
  }

  /**
   * List the complete, read-only version history of a document (newest first).
   * @throws DocumentNotFoundException if the document is missing
   */
  async findVersions(
    id: string,
    tenantId: string,
    branchId: string | undefined,
    page = 1,
    limit = 20,
  ): Promise<PaginatedResult<DocumentVersionEntity>> {
    await this.findById(id, tenantId, branchId);
    const where: Prisma.DocumentVersionWhereInput = {
      documentId: id,
      tenantId,
    };
    const data = await this.prisma.documentVersion.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { versionNo: 'desc' },
    });
    const total = await this.prisma.documentVersion.count({ where });
    return { data, total, page, limit };
  }

  /**
   * Fetch a single read-only version snapshot of a document.
   * @throws DocumentVersionNotFoundException if the version does not exist
   */
  async findVersionById(
    id: string,
    versionId: string,
    tenantId: string,
    branchId?: string,
  ): Promise<DocumentVersionEntity> {
    await this.findById(id, tenantId, branchId);
    const version = await this.prisma.documentVersion.findFirst({
      where: { id: versionId, documentId: id, tenantId },
    });
    if (!version) {
      throw new DocumentVersionNotFoundException(id, versionId);
    }
    return version;
  }

  /**
   * Validate that any supplied catalogue/author references belong to the tenant.
   * Reuses the exported Category/Department services; author + approver are
   * verified as active tenant staff via a `TenantStaffMembership` lookup.
   */
  private async validateRefs(
    tenantId: string,
    dto: {
      categoryId?: string;
      departmentId?: string;
      authorId?: string;
      approvedById?: string;
    },
  ): Promise<void> {
    if (dto.categoryId) {
      await this.categoryService.findById(dto.categoryId, tenantId);
    }
    if (dto.departmentId) {
      await this.departmentService.findById(dto.departmentId, tenantId);
    }
    if (dto.authorId) {
      await this.assertTenantStaff(dto.authorId, tenantId);
    }
    if (dto.approvedById) {
      await this.assertTenantStaff(dto.approvedById, tenantId);
    }
  }

  /** Throw unless `personId` is an active staff member of the tenant. */
  private async assertTenantStaff(
    personId: string,
    tenantId: string,
  ): Promise<void> {
    const membership = await this.prisma.tenantStaffMembership.findFirst({
      where: { personId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!membership) {
      throw new InvalidDocumentAuthorException(personId);
    }
  }

  /**
   * Throw if another active document in the same scope already uses
   * `documentNumber`. Scope is the branch for branch-level docs, or the
   * tenant-level set (`branchId === null`) for Business-Admin documents.
   * @param excludeId optional document id to exclude (the row being updated)
   */
  private async assertNumberAvailable(
    tenantId: string,
    branchId: string | null,
    documentNumber: string,
    excludeId?: string,
  ): Promise<void> {
    const dup = await this.prisma.document.findFirst({
      where: {
        tenantId,
        branchId,
        documentNumber,
        deletedAt: null,
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (dup) {
      throw new DocumentNumberConflictException(documentNumber);
    }
  }
}

import { Injectable } from '@nestjs/common';
import { Attachment } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAttachmentDto } from './dto/create-attachment.dto';
import { AttachmentNotFoundException } from './exceptions/attachments.exceptions';

/**
 * Generic attachment management. Tenant-scoped (defence-in-depth on top of RLS)
 * and optionally branch-level. Stores only the S3 URL + metadata of a file that
 * was already uploaded via `POST /uploads/attachment`; it owns no file bytes.
 * Any feature can attach/list/remove files against its records via
 * (`entityType`, `entityId`) without adding its own columns.
 */
@Injectable()
export class AttachmentsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Attach an already-uploaded file (its S3 URL) to an owner record.
   * @param tenantId owning tenant (from JWT)
   * @param branchId active branch (from JWT) or null for tenant-level owners
   * @param dto validated payload (entity ref + url + metadata)
   * @param actorId person recording the attachment
   * @returns the created attachment row
   */
  async create(
    tenantId: string,
    branchId: string | null,
    dto: CreateAttachmentDto,
    actorId: string,
  ): Promise<Attachment> {
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.attachment.create({
        data: {
          tenantId,
          branchId,
          entityType: dto.entityType,
          entityId: dto.entityId,
          category: dto.category ?? null,
          url: dto.url,
          fileName: dto.fileName,
          mimeType: dto.mimeType ?? null,
          fileSize: dto.fileSize ?? null,
          createdBy: actorId,
        },
      }),
    );
  }

  /**
   * List active attachments for one owner record, newest first.
   * @param tenantId tenant scope
   * @param entityType owner kind
   * @param entityId owner id
   * @param category optional sub-category filter
   */
  async findForEntity(
    tenantId: string,
    entityType: string,
    entityId: string,
    category?: string,
  ): Promise<Attachment[]> {
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.attachment.findMany({
        where: {
          tenantId,
          entityType,
          entityId,
          ...(category ? { category } : {}),
          deletedAt: null,
        },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  /**
   * Soft-delete an attachment.
   * @param id attachment id
   * @param tenantId tenant scope
   * @throws AttachmentNotFoundException if missing/soft-deleted or not in this tenant
   */
  async remove(id: string, tenantId: string): Promise<{ id: string }> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.attachment.findFirst({
        where: { id, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!existing) throw new AttachmentNotFoundException(id);
      await tx.attachment.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
      return { id };
    });
  }
}

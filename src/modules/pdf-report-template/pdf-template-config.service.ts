import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PdfReportTemplateService } from './pdf-report-template.service';
import { SavePdfTemplateConfigDto } from './dto/save-pdf-template-config.dto';
import {
  PDF_TEMPLATE_CONFIG_SLOT_GROUPS,
  PDF_TEMPLATE_CONFIG_SLOT_KEYS,
  PdfTemplateConfigSlotGroup,
} from './constants/pdf-template-config-slots.constant';
import { InvalidPdfTemplateConfigSlotException } from './exceptions/pdf-report-template.exceptions';

/** Current slot → template map: `{ [slotKey]: templateId | null }`. */
export type PdfTemplateConfigMap = Record<string, string | null>;

/**
 * The "Configuration" feature: a tenant's chosen DEFAULT PDF report template per
 * document slot. Tenant-scoped, branch-level (CLAUDE.md §4.6): the scope
 * (tenant + active branch) comes from the caller, never the body. Reads carry
 * `tenantId` (defence in depth on top of RLS); writes go through `withTenant`.
 */
@Injectable()
export class PdfTemplateConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly templateService: PdfReportTemplateService,
  ) {}

  /** The grouped slot catalogue for the Configuration UI. */
  getSlots(): PdfTemplateConfigSlotGroup[] {
    return PDF_TEMPLATE_CONFIG_SLOT_GROUPS;
  }

  /**
   * The current slot → template map for the caller's scope. Slots with no row
   * are simply absent (the frontend treats them as unset).
   * @param tenantId tenant scope
   * @param branchId active branch, or null for the tenant-wide config
   */
  async getConfig(
    tenantId: string,
    branchId: string | null,
  ): Promise<PdfTemplateConfigMap> {
    const rows = await this.prisma.pdfTemplateConfig.findMany({
      where: { tenantId, branchId, deletedAt: null },
    });
    const map: PdfTemplateConfigMap = {};
    for (const row of rows) {
      map[row.slotKey] = row.templateId;
    }
    return map;
  }

  /**
   * Upsert the supplied slot assignments for the caller's scope. Each `slotKey`
   * must be a known slot and each non-null `templateId` must be an active
   * template of the caller's tenant (validated before any write). The upsert is
   * wrapped in a transaction so a partial failure doesn't leave the config
   * half-applied.
   * @param tenantId tenant scope
   * @param branchId active branch, or null for the tenant-wide config
   * @param dto the assignments to apply
   * @param actorId person id of the editor (optional audit trail)
   * @returns the resulting slot → template map
   * @throws InvalidPdfTemplateConfigSlotException on an unknown slot key
   * @throws PdfReportTemplateNotFoundException if a `templateId` isn't in the tenant
   */
  async saveConfig(
    tenantId: string,
    branchId: string | null,
    dto: SavePdfTemplateConfigDto,
    actorId?: string,
  ): Promise<PdfTemplateConfigMap> {
    const knownSlots = new Set(PDF_TEMPLATE_CONFIG_SLOT_KEYS);
    for (const assignment of dto.assignments) {
      if (!knownSlots.has(assignment.slotKey)) {
        throw new InvalidPdfTemplateConfigSlotException(assignment.slotKey);
      }
      if (assignment.templateId) {
        // Throws PdfReportTemplateNotFoundException if it isn't the tenant's.
        await this.templateService.findById(assignment.templateId, tenantId);
      }
    }

    await this.prisma.withTenant(tenantId, async (tx) => {
      for (const assignment of dto.assignments) {
        const existing = await tx.pdfTemplateConfig.findFirst({
          where: {
            tenantId,
            branchId,
            slotKey: assignment.slotKey,
            deletedAt: null,
          },
        });
        if (existing) {
          await tx.pdfTemplateConfig.update({
            where: { id: existing.id },
            data: {
              templateId: assignment.templateId ?? null,
              updatedBy: actorId ?? null,
            },
          });
        } else {
          await tx.pdfTemplateConfig.create({
            data: {
              tenantId,
              branchId,
              slotKey: assignment.slotKey,
              templateId: assignment.templateId ?? null,
              createdBy: actorId ?? null,
              updatedBy: actorId ?? null,
            },
          });
        }
      }
    });

    return this.getConfig(tenantId, branchId);
  }
}

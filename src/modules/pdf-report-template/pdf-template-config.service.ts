import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PdfReportTemplateService } from './pdf-report-template.service';
import { SavePdfTemplateConfigDto } from './dto/save-pdf-template-config.dto';
import {
  PDF_TEMPLATE_CONFIG_SLOT_GROUPS,
  PDF_TEMPLATE_CONFIG_SLOT_KEYS,
  PdfTemplateConfigSlotGroup,
} from './constants/pdf-template-config-slots.constant';
import {
  InvalidPdfTemplateConfigSlotException,
  PdfTemplateConfigTypeMismatchException,
} from './exceptions/pdf-report-template.exceptions';

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
   * The configured DEFAULT template id for a single slot, preferring the active
   * branch's config and falling back to the tenant-wide config. Returns null
   * when the slot is unset in both scopes, or when the configured template is no
   * longer an active (non-deleted) template of the tenant. Used by print flows
   * to honor the "Configuration" default before falling back to the first active
   * template (see §3 of the barcode-printing workflow).
   * @param tenantId tenant scope
   * @param branchId active branch (checked first), or null for tenant-wide only
   * @param slotKey the config slot / template type key (e.g. `order_label_print`)
   */
  async resolveConfiguredTemplateId(
    tenantId: string,
    branchId: string | null,
    slotKey: string,
  ): Promise<string | null> {
    const scopes: (string | null)[] = branchId ? [branchId, null] : [null];
    for (const scope of scopes) {
      const map = await this.getConfig(tenantId, scope);
      const templateId = map[slotKey];
      if (templateId && (await this.isActiveTemplate(templateId, tenantId))) {
        return templateId;
      }
    }
    return null;
  }

  /** True when `templateId` is an active, non-deleted template of the tenant. */
  private async isActiveTemplate(
    templateId: string,
    tenantId: string,
  ): Promise<boolean> {
    const template = await this.prisma.pdfReportTemplate.findFirst({
      where: { id: templateId, tenantId, deletedAt: null, isActive: true },
      select: { id: true },
    });
    return template !== null;
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
        const template = await this.templateService.findById(
          assignment.templateId,
          tenantId,
        );
        // A slot may only hold a template of its OWN type — a `lab_report`
        // slot can't be pointed at a `lab_all_report` (or any other) template,
        // which would break rendering (wrong engine/context) at print time.
        if (template.type !== assignment.slotKey) {
          throw new PdfTemplateConfigTypeMismatchException(
            assignment.slotKey,
            template.type,
          );
        }
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

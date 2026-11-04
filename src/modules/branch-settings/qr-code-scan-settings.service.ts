import { Injectable } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BranchService } from '../branch/branch.service';
import { SaveQrCodeScanSettingsDto } from './dto/save-qr-code-scan-settings.dto';
import { QrCodeScanSettings } from './entities/qr-code-scan-settings.entity';
import { QrScanTemplateNotFoundException } from './exceptions/qr-code-scan-settings.exceptions';

/** The `pdf_report_templates.type` a Bill Print template must carry. */
const BILL_PRINT_TEMPLATE_TYPE = 'bill_print';
/** The `pdf_report_templates.type` a Report Print template must carry. */
const REPORT_PRINT_TEMPLATE_TYPE = 'lab_all_report';

/** The columns that make up the public QR Code Scan settings shape. */
const SELECT = {
  billPrintablePaymentStatuses: true,
  billPrintTemplateId: true,
  reportPrintTemplateId: true,
} as const;

/**
 * Per-branch QR Code Scan settings (Branch Admin › Branch Settings): what a
 * patient may open/print after scanning the QR code on their bill or report.
 * One row per branch (unique `(tenantId, branchId)`), created on first read so
 * the frontend always receives a complete object. Mirrors
 * `TechnicianSettingsService` for its branch-scoped upsert pattern.
 */
@Injectable()
export class QrCodeScanSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchService: BranchService,
  ) {}

  /**
   * Fetch the branch's QR Code Scan settings, creating the default row on first
   * access (bill: PAID printable; no templates chosen).
   * @param branchId the active branch from the token
   * @throws BranchNotFoundException if the branch is missing/other tenant
   */
  async getForBranch(
    tenantId: string,
    branchId: string,
  ): Promise<QrCodeScanSettings> {
    await this.branchService.findById(branchId, tenantId);
    const row = await this.prisma.qrCodeScanSetting.upsert({
      where: { tenantId_branchId: { tenantId, branchId } },
      create: { tenantId, branchId },
      update: {},
      select: SELECT,
    });
    return row;
  }

  /**
   * Save (partial patch, upsert) the branch's QR Code Scan settings. A field left
   * out of `dto` keeps its value; a template id passed as `null` clears it. Any
   * template id provided is checked to belong to this tenant and carry the right
   * `type`, so one branch cannot point at another tenant's template.
   * @param branchId the active branch from the token
   * @throws BranchNotFoundException if the branch is missing/other tenant
   * @throws QrScanTemplateNotFoundException if a chosen template is missing/wrong type
   */
  async saveForBranch(
    tenantId: string,
    branchId: string,
    dto: SaveQrCodeScanSettingsDto,
  ): Promise<QrCodeScanSettings> {
    await this.branchService.findById(branchId, tenantId);

    if (dto.billPrintTemplateId) {
      await this.assertTemplate(
        tenantId,
        dto.billPrintTemplateId,
        BILL_PRINT_TEMPLATE_TYPE,
      );
    }
    if (dto.reportPrintTemplateId) {
      await this.assertTemplate(
        tenantId,
        dto.reportPrintTemplateId,
        REPORT_PRINT_TEMPLATE_TYPE,
      );
    }

    const patch: {
      billPrintablePaymentStatuses?: PaymentStatus[];
      billPrintTemplateId?: string | null;
      reportPrintTemplateId?: string | null;
    } = {};
    if (dto.billPrintablePaymentStatuses !== undefined) {
      patch.billPrintablePaymentStatuses = dto.billPrintablePaymentStatuses;
    }
    if (dto.billPrintTemplateId !== undefined) {
      patch.billPrintTemplateId = dto.billPrintTemplateId;
    }
    if (dto.reportPrintTemplateId !== undefined) {
      patch.reportPrintTemplateId = dto.reportPrintTemplateId;
    }

    const row = await this.prisma.qrCodeScanSetting.upsert({
      where: { tenantId_branchId: { tenantId, branchId } },
      create: { tenantId, branchId, ...patch },
      update: patch,
      select: SELECT,
    });
    return row;
  }

  /**
   * Verify a chosen print template exists in this tenant, is active, not deleted,
   * and is of the expected `type`.
   * @throws QrScanTemplateNotFoundException otherwise
   */
  private async assertTemplate(
    tenantId: string,
    templateId: string,
    type: string,
  ): Promise<void> {
    const found = await this.prisma.pdfReportTemplate.findFirst({
      where: { id: templateId, tenantId, type, deletedAt: null },
      select: { id: true },
    });
    if (!found) {
      throw new QrScanTemplateNotFoundException(templateId, type);
    }
  }
}

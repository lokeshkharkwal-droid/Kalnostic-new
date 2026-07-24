import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateInventoryUsageDto, UpdateInventoryUsageDto } from './dto/inventory-usage.dto';
import {
  ActiveBranchRequiredException,
  LabReportNotFoundException,
  WorklistEntryNotFoundException,
} from './exceptions/lab-report.exceptions';

/**
 * Generate Inventory (LABORATORY.docx §5.9) — manual material-usage entry
 * against a `LabReport`. Manual only: the doc's "materials attached to the
 * test in the back end are reflected here automatically" behaviour is not
 * built, since no inventory master/catalogue module exists anywhere in this
 * codebase to source it from — `inventoryItemId` is a free-text-backed field
 * here, same as the frontend's plain "Material" text input, not a real FK.
 * Total PU/BU are display-only (allocated + re-run + wastage), computed on
 * read rather than stored, matching the frontend's own auto-computed column.
 */
@Injectable()
export class InventoryUsageService {
  constructor(private readonly prisma: PrismaService) {}

  private requireBranch(branchId: string | null): string {
    if (!branchId) throw new ActiveBranchRequiredException();
    return branchId;
  }

  private async requireReport(id: string, tenantId: string, branchId: string) {
    const report = await this.prisma.labReport.findFirst({
      where: { id, tenantId, branchId, deletedAt: null },
    });
    if (!report) throw new LabReportNotFoundException(id);
    return report;
  }

  async findAll(labReportId: string, tenantId: string, branchId: string | null) {
    const activeBranchId = this.requireBranch(branchId);
    await this.requireReport(labReportId, tenantId, activeBranchId);

    return this.prisma.labReportInventoryUsage.findMany({
      where: { labReportId, tenantId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(
    labReportId: string,
    tenantId: string,
    branchId: string | null,
    dto: CreateInventoryUsageDto,
  ) {
    const activeBranchId = this.requireBranch(branchId);
    await this.requireReport(labReportId, tenantId, activeBranchId);

    return this.prisma.labReportInventoryUsage.create({
      data: {
        tenantId,
        labReportId,
        inventoryItemId: dto.inventoryItemId,
        batchNumber: dto.batchNumber,
        expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : undefined,
        allocatedPu: dto.allocatedPu ?? 0,
        allocatedBu: dto.allocatedBu ?? 0,
        reRunPu: dto.reRunPu ?? 0,
        reRunBu: dto.reRunBu ?? 0,
        wastagePu: dto.wastagePu ?? 0,
        wastageBu: dto.wastageBu ?? 0,
        remarks: dto.remarks,
      },
    });
  }

  async update(
    labReportId: string,
    usageId: string,
    tenantId: string,
    branchId: string | null,
    dto: UpdateInventoryUsageDto,
  ) {
    const activeBranchId = this.requireBranch(branchId);
    await this.requireReport(labReportId, tenantId, activeBranchId);

    const usage = await this.prisma.labReportInventoryUsage.findFirst({
      where: { id: usageId, labReportId, tenantId, deletedAt: null },
    });
    if (!usage) throw new WorklistEntryNotFoundException('inventory_usage', usageId);

    return this.prisma.labReportInventoryUsage.update({
      where: { id: usageId },
      data: {
        inventoryItemId: dto.inventoryItemId,
        batchNumber: dto.batchNumber,
        expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : undefined,
        allocatedPu: dto.allocatedPu,
        allocatedBu: dto.allocatedBu,
        reRunPu: dto.reRunPu,
        reRunBu: dto.reRunBu,
        wastagePu: dto.wastagePu,
        wastageBu: dto.wastageBu,
        remarks: dto.remarks,
      },
    });
  }

  async remove(
    labReportId: string,
    usageId: string,
    tenantId: string,
    branchId: string | null,
  ) {
    const activeBranchId = this.requireBranch(branchId);
    await this.requireReport(labReportId, tenantId, activeBranchId);

    const usage = await this.prisma.labReportInventoryUsage.findFirst({
      where: { id: usageId, labReportId, tenantId, deletedAt: null },
    });
    if (!usage) throw new WorklistEntryNotFoundException('inventory_usage', usageId);

    return this.prisma.labReportInventoryUsage.update({
      where: { id: usageId },
      data: { deletedAt: new Date() },
    });
  }
}

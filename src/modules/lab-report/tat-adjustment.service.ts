import { Injectable } from '@nestjs/common';
import { TatAdjustment } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTatAdjustmentDto } from './dto/tat-adjustment.dto';
import { resolveActorNames } from './entities/worklist.entity';
import {
  ActiveBranchRequiredException,
  LabReportNotFoundException,
  WorklistEntryNotFoundException,
} from './exceptions/lab-report.exceptions';

/**
 * Manual TAT adjustment audit log ("Adjust TAT History" — Turnaround Time
 * Details modal, Technician/Reporting). Append-only from the user's
 * perspective: create + list + soft-delete only, no edit-in-place. Purely a
 * record of *why* a TAT figure was manually annotated — it does not itself
 * change any TAT calculation (see `TatService` for the actual TAT engine).
 */
@Injectable()
export class TatAdjustmentService {
  constructor(private readonly prisma: PrismaService) {}

  private requireBranch(branchId: string | null): string {
    if (!branchId) throw new ActiveBranchRequiredException();
    return branchId;
  }

  private async requireReport(
    labReportId: string,
    tenantId: string,
    branchId: string,
  ) {
    const report = await this.prisma.labReport.findFirst({
      where: { id: labReportId, tenantId, branchId, deletedAt: null },
      select: { id: true },
    });
    if (!report) throw new LabReportNotFoundException(labReportId);
  }

  /**
   * Add a TAT adjustment record to a report.
   * @param labReportId the report the adjustment is against
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT); required
   * @param actorId the acting person's id, recorded as `enteredBy`
   * @param dto reason + optional notes
   * @throws ActiveBranchRequiredException / LabReportNotFoundException
   */
  async create(
    labReportId: string,
    tenantId: string,
    branchId: string | null,
    actorId: string | null,
    dto: CreateTatAdjustmentDto,
  ) {
    const activeBranchId = this.requireBranch(branchId);
    await this.requireReport(labReportId, tenantId, activeBranchId);

    return this.prisma.tatAdjustment.create({
      data: {
        tenantId,
        branchId: activeBranchId,
        labReportId,
        reason: dto.reason,
        notes: dto.notes,
        enteredBy: actorId,
      },
    });
  }

  /**
   * List a report's TAT adjustment history, most recent first. Attaches
   * `enteredByName` (resolved from `Person`) alongside the raw `enteredBy`
   * id — same resolve-and-fall-back-to-raw-id convention as
   * `LabReportService.enrichActorNames`/`resolveActorNames` elsewhere in this
   * module, so the UI never has to display a bare person id.
   * @param labReportId the report to list adjustments for
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT); required
   * @throws ActiveBranchRequiredException / LabReportNotFoundException
   */
  async findAll(
    labReportId: string,
    tenantId: string,
    branchId: string | null,
  ): Promise<Array<TatAdjustment & { enteredByName: string | null }>> {
    const activeBranchId = this.requireBranch(branchId);
    await this.requireReport(labReportId, tenantId, activeBranchId);

    const rows = await this.prisma.tatAdjustment.findMany({
      where: {
        labReportId,
        tenantId,
        branchId: activeBranchId,
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });

    const nameById = await resolveActorNames(
      this.prisma,
      rows.map((r) => r.enteredBy),
    );
    return rows.map((r) => ({
      ...r,
      enteredByName: r.enteredBy
        ? (nameById.get(r.enteredBy) ?? r.enteredBy)
        : null,
    }));
  }

  /**
   * Soft-delete a TAT adjustment record.
   * @param labReportId the report the adjustment belongs to (route scoping)
   * @param adjustmentId the adjustment to remove
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT); required
   * @throws ActiveBranchRequiredException / WorklistEntryNotFoundException
   */
  async remove(
    labReportId: string,
    adjustmentId: string,
    tenantId: string,
    branchId: string | null,
  ) {
    const activeBranchId = this.requireBranch(branchId);
    const existing = await this.prisma.tatAdjustment.findFirst({
      where: {
        id: adjustmentId,
        labReportId,
        tenantId,
        branchId: activeBranchId,
        deletedAt: null,
      },
    });
    if (!existing) {
      throw new WorklistEntryNotFoundException('tat_adjustment', adjustmentId);
    }

    return this.prisma.tatAdjustment.update({
      where: { id: adjustmentId },
      data: { deletedAt: new Date() },
    });
  }
}

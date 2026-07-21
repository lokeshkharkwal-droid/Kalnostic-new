import { Injectable } from '@nestjs/common';
import { ActionWorklistStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LabReportService } from './lab-report.service';
import { RaiseReRunDto } from './dto/re-run.dto';
import { UpdateActionWorklistStatusDto } from './dto/update-worklist-status.dto';
import { WORKLIST_REPORT_INCLUDE } from './entities/worklist.entity';
import {
  ActiveBranchRequiredException,
  LabReportNotFoundException,
  WorklistEntryNotFoundException,
} from './exceptions/lab-report.exceptions';

/**
 * Re-Run worklist (LABORATORY.docx §5.5, §8.1). Raising a re-run both resets
 * the LabReport (any status -> Pending, results cleared, via
 * `LabReportService.resetForRerun`) and creates this tracking row, so the
 * report-side reset and the worklist-tracking-to-completion stay independent
 * concerns, matching the spec's "Re-Run Status reflects the current report
 * status ... independently". Uses `ActionWorklistStatus`
 * (Pending/In Progress/Completed) — §8.1 never describes a "New" state here,
 * unlike Critical Alerts/Out of Range.
 */
@Injectable()
export class ReRunService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly labReportService: LabReportService,
  ) {}

  private requireBranch(branchId: string | null): string {
    if (!branchId) throw new ActiveBranchRequiredException();
    return branchId;
  }

  async raise(
    labReportId: string,
    tenantId: string,
    branchId: string | null,
    actorId: string,
    dto: RaiseReRunDto,
  ) {
    const activeBranchId = this.requireBranch(branchId);
    const report = await this.prisma.labReport.findFirst({
      where: { id: labReportId, tenantId, branchId: activeBranchId, deletedAt: null },
    });
    if (!report) throw new LabReportNotFoundException(labReportId);

    await this.labReportService.resetForRerun(
      labReportId,
      tenantId,
      activeBranchId,
      actorId,
    );

    return this.prisma.reRunRequest.create({
      data: {
        tenantId,
        branchId: activeBranchId,
        labReportId,
        status: ActionWorklistStatus.PENDING,
        requestedBy: actorId,
        requestNotes: dto.notes,
      },
    });
  }

  async findAll(tenantId: string, branchId: string | null) {
    const activeBranchId = this.requireBranch(branchId);
    return this.prisma.reRunRequest.findMany({
      where: { tenantId, branchId: activeBranchId, deletedAt: null },
      include: WORKLIST_REPORT_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateStatus(
    id: string,
    tenantId: string,
    branchId: string | null,
    dto: UpdateActionWorklistStatusDto,
  ) {
    const activeBranchId = this.requireBranch(branchId);
    const entry = await this.prisma.reRunRequest.findFirst({
      where: { id, tenantId, branchId: activeBranchId, deletedAt: null },
    });
    if (!entry) throw new WorklistEntryNotFoundException('re_run_request', id);

    return this.prisma.reRunRequest.update({
      where: { id },
      data: {
        status: dto.status,
        requestNotes: dto.notes ?? entry.requestNotes,
      },
    });
  }
}

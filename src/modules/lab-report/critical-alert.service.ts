import {
  worklistRowBranchWhere,
  type WorklistBranchScope,
} from './access/worklist-branch-scope';
import { Injectable } from '@nestjs/common';
import { AlertReviewStatus, WorklistTrigger } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { assertReportNotSentOut } from './utils/sent-out-report.util';
import { LabReportService } from './lab-report.service';
import { RaiseWorklistEntryDto } from './dto/raise-worklist-entry.dto';
import { UpdateAlertReviewStatusDto } from './dto/update-worklist-status.dto';
import {
  CRITICAL_ALERT_INCLUDE,
  attachWorklistBranchNames,
  attachWorklistSampleStatuses,
  toWorklistReportContext,
} from './entities/worklist.entity';
import {
  ActiveBranchRequiredException,
  LabReportNotFoundException,
  WorklistEntryNotFoundException,
} from './exceptions/lab-report.exceptions';

/**
 * Critical Alerts worklist (LABORATORY.docx §5.3, §8.2). Raised manually via
 * "Inform Critical Alert" (this service) or automatically when a value falls
 * inside the Admin-configured critical range and auto-trigger is enabled in
 * Technician Reporting Settings (that automatic path is not implemented here —
 * it depends on Reporting Settings, out of scope for this pass; `raise` covers
 * the manual trigger only, `trigger: MANUAL`).
 *
 * Per CR-02, this worklist's own row actions do NOT include "Inform Critical
 * Alert" again (redundant) — that action only lives on the Test Entry screen,
 * i.e. only reachable via `LabReportController`, not exposed again here.
 */
@Injectable()
export class CriticalAlertService {
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
    dto: RaiseWorklistEntryDto,
  ) {
    const activeBranchId = this.requireBranch(branchId);
    const report = await this.prisma.labReport.findFirst({
      where: {
        id: labReportId,
        tenantId,
        branchId: activeBranchId,
        deletedAt: null,
      },
    });
    if (!report) throw new LabReportNotFoundException(labReportId);
    await assertReportNotSentOut(this.prisma, tenantId, labReportId);

    return this.prisma
      .$transaction(async (tx) => {
        const alert = await tx.criticalAlert.create({
          data: {
            tenantId,
            branchId: activeBranchId,
            labReportId,
            status: AlertReviewStatus.NEW,
            trigger: WorklistTrigger.MANUAL,
            reportStatusAtTrigger: report.status,
            resultParamId: dto.resultParamId,
            createdBy: actorId,
          },
        });
        await tx.labReportNote.create({
          data: {
            tenantId,
            labReportId,
            category: 'CRITICAL_ALERT',
            body: dto.notes,
            createdBy: actorId,
          },
        });
        return alert;
      })
      .then(async (alert) => {
        await this.labReportService.recordWorklistHistory(
          tenantId,
          labReportId,
          'critical_alert_raised',
          actorId,
          dto.notes,
        );
        return alert;
      });
  }

  /**
   * The worklist's entries for the branches in `scope` (the caller's own branch by
   * default; several branches for "All Branches" — see
   * `TechnicianBranchAccessService.resolveScope`).
   */
  async findAll(tenantId: string, scope: WorklistBranchScope) {
    const rows = await this.prisma.criticalAlert.findMany({
      where: { tenantId, ...worklistRowBranchWhere(scope), deletedAt: null },
      include: CRITICAL_ALERT_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    let reports = rows.map((r) => toWorklistReportContext(r.labReport));
    reports = await attachWorklistBranchNames(this.prisma, tenantId, reports);
    reports = await attachWorklistSampleStatuses(
      this.prisma,
      tenantId,
      reports,
    );

    return rows.map(({ labReport: _labReport, ...alert }, i) => ({
      ...alert,
      report: reports[i],
    }));
  }

  async updateStatus(
    id: string,
    tenantId: string,
    branchId: string | null,
    actorId: string,
    dto: UpdateAlertReviewStatusDto,
  ) {
    const activeBranchId = this.requireBranch(branchId);
    const entry = await this.prisma.criticalAlert.findFirst({
      where: {
        id,
        tenantId,
        deletedAt: null,
        // Tied to the REPORT's branch, not the branch stamped on this row when it
        // was raised: the row keeps that branch after the report is re-homed.
        labReport: { is: { branchId: activeBranchId, deletedAt: null } },
      },
    });
    if (!entry) throw new WorklistEntryNotFoundException('critical_alert', id);
    await assertReportNotSentOut(this.prisma, tenantId, entry.labReportId);

    const updated = await this.prisma.$transaction(async (tx) => {
      const updatedEntry = await tx.criticalAlert.update({
        where: { id },
        data: { status: dto.status },
      });
      if (dto.notes) {
        await tx.labReportNote.create({
          data: {
            tenantId,
            labReportId: entry.labReportId,
            category: 'CRITICAL_ALERT',
            body: dto.notes,
            createdBy: entry.createdBy ?? 'system',
          },
        });
      }
      return updatedEntry;
    });

    await this.labReportService.recordWorklistHistory(
      tenantId,
      entry.labReportId,
      `critical_alert_status_${entry.status}_to_${dto.status}`.toLowerCase(),
      actorId,
      dto.notes,
    );

    return updated;
  }
}

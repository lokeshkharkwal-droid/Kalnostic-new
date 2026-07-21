import { Injectable } from '@nestjs/common';
import { WorklistStatus, WorklistTrigger } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RaiseWorklistEntryDto } from './dto/raise-worklist-entry.dto';
import { UpdateWorklistStatusDto } from './dto/update-worklist-status.dto';
import { CRITICAL_ALERT_INCLUDE } from './entities/worklist.entity';
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
  constructor(private readonly prisma: PrismaService) {}

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
      where: { id: labReportId, tenantId, branchId: activeBranchId, deletedAt: null },
    });
    if (!report) throw new LabReportNotFoundException(labReportId);

    return this.prisma.$transaction(async (tx) => {
      const alert = await tx.criticalAlert.create({
        data: {
          tenantId,
          branchId: activeBranchId,
          labReportId,
          status: WorklistStatus.NEW,
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
    });
  }

  async findAll(tenantId: string, branchId: string | null) {
    const activeBranchId = this.requireBranch(branchId);
    return this.prisma.criticalAlert.findMany({
      where: { tenantId, branchId: activeBranchId, deletedAt: null },
      include: CRITICAL_ALERT_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateStatus(
    id: string,
    tenantId: string,
    branchId: string | null,
    dto: UpdateWorklistStatusDto,
  ) {
    const activeBranchId = this.requireBranch(branchId);
    const entry = await this.prisma.criticalAlert.findFirst({
      where: { id, tenantId, branchId: activeBranchId, deletedAt: null },
    });
    if (!entry) throw new WorklistEntryNotFoundException('critical_alert', id);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.criticalAlert.update({
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
      return updated;
    });
  }
}

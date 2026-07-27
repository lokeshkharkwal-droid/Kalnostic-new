import { Injectable } from '@nestjs/common';
import { WorklistStatus, WorklistTrigger } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LabReportService } from './lab-report.service';
import { RaiseWorklistEntryDto } from './dto/raise-worklist-entry.dto';
import { UpdateWorklistStatusDto } from './dto/update-worklist-status.dto';
import {
  OUT_OF_RANGE_INCLUDE,
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
 * Out of Range worklist (LABORATORY.docx §5.4, §8.3). Same shape as
 * CriticalAlertService (manual trigger here; automatic trigger from the
 * Admin-configured normal ranges is out of scope, same reasoning as Critical
 * Alerts' automatic path).
 */
@Injectable()
export class OutOfRangeService {
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
      where: { id: labReportId, tenantId, branchId: activeBranchId, deletedAt: null },
    });
    if (!report) throw new LabReportNotFoundException(labReportId);

    return this.prisma.$transaction(async (tx) => {
      const flag = await tx.outOfRangeFlag.create({
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
          category: 'OUT_OF_RANGE',
          body: dto.notes,
          createdBy: actorId,
        },
      });
      return flag;
    }).then(async (flag) => {
      await this.labReportService.recordWorklistHistory(
        tenantId,
        labReportId,
        'out_of_range_raised',
        actorId,
        dto.notes,
      );
      return flag;
    });
  }

  async findAll(tenantId: string, branchId: string | null) {
    const activeBranchId = this.requireBranch(branchId);
    const rows = await this.prisma.outOfRangeFlag.findMany({
      where: { tenantId, branchId: activeBranchId, deletedAt: null },
      include: OUT_OF_RANGE_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    let reports = rows.map((r) => toWorklistReportContext(r.labReport));
    reports = await attachWorklistBranchNames(this.prisma, tenantId, reports);
    reports = await attachWorklistSampleStatuses(this.prisma, tenantId, reports);

    return rows.map(({ labReport: _labReport, ...flag }, i) => ({
      ...flag,
      report: reports[i],
    }));
  }

  async updateStatus(
    id: string,
    tenantId: string,
    branchId: string | null,
    actorId: string,
    dto: UpdateWorklistStatusDto,
  ) {
    const activeBranchId = this.requireBranch(branchId);
    const entry = await this.prisma.outOfRangeFlag.findFirst({
      where: { id, tenantId, branchId: activeBranchId, deletedAt: null },
    });
    if (!entry) throw new WorklistEntryNotFoundException('out_of_range_flag', id);

    const updated = await this.prisma.$transaction(async (tx) => {
      const updatedEntry = await tx.outOfRangeFlag.update({
        where: { id },
        data: { status: dto.status },
      });
      if (dto.notes) {
        await tx.labReportNote.create({
          data: {
            tenantId,
            labReportId: entry.labReportId,
            category: 'OUT_OF_RANGE',
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
      `out_of_range_status_${entry.status}_to_${dto.status}`.toLowerCase(),
      actorId,
      dto.notes,
    );

    return updated;
  }
}

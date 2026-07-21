import { Injectable } from '@nestjs/common';
import { DeltaCheckStatus, WorklistTrigger } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RaiseWorklistEntryDto } from './dto/raise-worklist-entry.dto';
import { UpdateDeltaCheckStatusDto } from './dto/update-worklist-status.dto';
import { DELTA_CHECK_INCLUDE } from './entities/worklist.entity';
import {
  ActiveBranchRequiredException,
  LabReportNotFoundException,
  WorklistEntryNotFoundException,
} from './exceptions/lab-report.exceptions';

/**
 * Delta Check worklist (LABORATORY.docx §5.2, §8.4). Own status vocabulary
 * (New -> Reviewed -> Re-Run/Accepted -> Completed), distinct from
 * `WorklistStatus` (Critical Alerts/Out of Range) and `ActionWorklistStatus`
 * (Re-Run/Schedule Test). `raise` covers the manual trigger; automatic
 * detection (abnormal vs. the patient's previous result) is out of scope for
 * this pass — `findPreviousResultValue` is provided as the lookup a future
 * automatic-trigger job would call.
 */
@Injectable()
export class DeltaCheckService {
  constructor(private readonly prisma: PrismaService) {}

  private requireBranch(branchId: string | null): string {
    if (!branchId) throw new ActiveBranchRequiredException();
    return branchId;
  }

  /**
   * Find the patient's most recent prior LabReportResultValue for the same
   * result parameter (excluding the current report), for delta comparison.
   */
  private async findPreviousResultValue(
    tenantId: string,
    patientId: string,
    resultParamId: string,
    excludeLabReportId: string,
  ) {
    return this.prisma.labReportResultValue.findFirst({
      where: {
        tenantId,
        resultParamId,
        deletedAt: null,
        labReportId: { not: excludeLabReportId },
        labReport: {
          orderItem: { order: { patientId } },
        },
      },
      orderBy: { enteredAt: 'desc' },
    });
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
      include: { orderItem: { include: { order: true } } },
    });
    if (!report) throw new LabReportNotFoundException(labReportId);

    let previousResultValueId: string | undefined;
    if (dto.resultParamId) {
      const previous = await this.findPreviousResultValue(
        tenantId,
        report.orderItem.order.patientId,
        dto.resultParamId,
        labReportId,
      );
      previousResultValueId = previous?.id;
    }

    return this.prisma.$transaction(async (tx) => {
      const delta = await tx.deltaCheck.create({
        data: {
          tenantId,
          branchId: activeBranchId,
          labReportId,
          status: DeltaCheckStatus.NEW,
          trigger: WorklistTrigger.MANUAL,
          resultParamId: dto.resultParamId,
          previousResultValueId,
          createdBy: actorId,
        },
      });
      await tx.labReportNote.create({
        data: {
          tenantId,
          labReportId,
          category: 'DELTA',
          body: dto.notes,
          createdBy: actorId,
        },
      });
      return delta;
    });
  }

  async findAll(tenantId: string, branchId: string | null) {
    const activeBranchId = this.requireBranch(branchId);
    return this.prisma.deltaCheck.findMany({
      where: { tenantId, branchId: activeBranchId, deletedAt: null },
      include: DELTA_CHECK_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateStatus(
    id: string,
    tenantId: string,
    branchId: string | null,
    dto: UpdateDeltaCheckStatusDto,
  ) {
    const activeBranchId = this.requireBranch(branchId);
    const entry = await this.prisma.deltaCheck.findFirst({
      where: { id, tenantId, branchId: activeBranchId, deletedAt: null },
    });
    if (!entry) throw new WorklistEntryNotFoundException('delta_check', id);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.deltaCheck.update({
        where: { id },
        data: { status: dto.status },
      });
      if (dto.notes) {
        await tx.labReportNote.create({
          data: {
            tenantId,
            labReportId: entry.labReportId,
            category: 'DELTA',
            body: dto.notes,
            createdBy: entry.createdBy ?? 'system',
          },
        });
      }
      return updated;
    });
  }
}

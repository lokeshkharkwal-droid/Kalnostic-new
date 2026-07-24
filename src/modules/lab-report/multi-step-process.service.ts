import { Injectable } from '@nestjs/common';
import { MultiStepStage, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AdvanceMultiStepStageDto,
  AssignMultiStepProcessDto,
} from './dto/multi-step-process.dto';
import {
  ActiveBranchRequiredException,
  InvalidMultiStepTransitionException,
  LabReportNotFoundException,
  MultiStepProcessNotFoundException,
} from './exceptions/lab-report.exceptions';

/** The fixed forward sequence (LABORATORY.docx §5.7's own example: grossing →
 * sectioning → staining → reporting) — one stage at a time, no skipping, no
 * going backward, since these are physical lab steps, not arbitrary labels. */
const STAGE_SEQUENCE: readonly MultiStepStage[] = [
  MultiStepStage.GROSSING,
  MultiStepStage.SECTIONING,
  MultiStepStage.STAINING,
  MultiStepStage.REPORTING,
];

interface StageHistoryEntry {
  stage: MultiStepStage;
  enteredAt: string;
  enteredBy: string | null;
}

/**
 * Assign Multi-Step Test Process (LABORATORY.docx §5.7) — for tests involving
 * multiple lab steps (histopathology, cultures, etc.). A separate, smaller
 * state machine from `LabReport.status`: a test can be mid-process (e.g.
 * STAINING) while its report status is still VALIDATION_PENDING. One row per
 * report (`MultiStepTestProcess.labReportId` is `@unique`).
 */
@Injectable()
export class MultiStepProcessService {
  constructor(private readonly prisma: PrismaService) {}

  private requireBranch(branchId: string | null): string {
    if (!branchId) throw new ActiveBranchRequiredException();
    return branchId;
  }

  private stageHistoryEntry(stage: MultiStepStage, actorId: string | null): StageHistoryEntry {
    return { stage, enteredAt: new Date().toISOString(), enteredBy: actorId };
  }

  async assign(
    labReportId: string,
    tenantId: string,
    branchId: string | null,
    actorId: string,
    dto: AssignMultiStepProcessDto,
  ) {
    const activeBranchId = this.requireBranch(branchId);
    const report = await this.prisma.labReport.findFirst({
      where: { id: labReportId, tenantId, branchId: activeBranchId, deletedAt: null },
    });
    if (!report) throw new LabReportNotFoundException(labReportId);

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.multiStepTestProcess.findUnique({
        where: { labReportId },
      });

      const initialStage = MultiStepStage.GROSSING;
      const historyEntry = this.stageHistoryEntry(initialStage, actorId);

      const process = existing
        ? await tx.multiStepTestProcess.update({
            where: { labReportId },
            data: {
              processType: dto.processType,
              currentStage: initialStage,
              stageHistory: [historyEntry] as unknown as Prisma.InputJsonValue,
              deletedAt: null,
            },
          })
        : await tx.multiStepTestProcess.create({
            data: {
              tenantId,
              branchId: activeBranchId,
              labReportId,
              processType: dto.processType,
              currentStage: initialStage,
              stageHistory: [historyEntry] as unknown as Prisma.InputJsonValue,
              createdBy: actorId,
            },
          });

      if (dto.notes) {
        await tx.labReportNote.create({
          data: {
            tenantId,
            labReportId,
            category: 'MULTI_STEP',
            body: dto.notes,
            createdBy: actorId,
          },
        });
      }

      return process;
    });
  }

  async findByReport(labReportId: string, tenantId: string, branchId: string | null) {
    const activeBranchId = this.requireBranch(branchId);
    const report = await this.prisma.labReport.findFirst({
      where: { id: labReportId, tenantId, branchId: activeBranchId, deletedAt: null },
    });
    if (!report) throw new LabReportNotFoundException(labReportId);

    const process = await this.prisma.multiStepTestProcess.findFirst({
      where: { labReportId, tenantId, deletedAt: null },
    });
    if (!process) throw new MultiStepProcessNotFoundException(labReportId);
    return process;
  }

  async advance(
    labReportId: string,
    tenantId: string,
    branchId: string | null,
    actorId: string,
    dto: AdvanceMultiStepStageDto,
  ) {
    const activeBranchId = this.requireBranch(branchId);
    const report = await this.prisma.labReport.findFirst({
      where: { id: labReportId, tenantId, branchId: activeBranchId, deletedAt: null },
    });
    if (!report) throw new LabReportNotFoundException(labReportId);

    const process = await this.prisma.multiStepTestProcess.findFirst({
      where: { labReportId, tenantId, deletedAt: null },
    });
    if (!process) throw new MultiStepProcessNotFoundException(labReportId);

    const currentIndex = STAGE_SEQUENCE.indexOf(process.currentStage);
    const expectedNextStage = STAGE_SEQUENCE[currentIndex + 1];
    if (!expectedNextStage || dto.stage !== expectedNextStage) {
      throw new InvalidMultiStepTransitionException(
        process.currentStage,
        dto.stage,
        expectedNextStage ?? '(already at the final stage)',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const existingHistory = Array.isArray(process.stageHistory)
        ? (process.stageHistory as unknown as StageHistoryEntry[])
        : [];
      const historyEntry = this.stageHistoryEntry(dto.stage, actorId);

      const updated = await tx.multiStepTestProcess.update({
        where: { labReportId },
        data: {
          currentStage: dto.stage,
          stageHistory: [...existingHistory, historyEntry] as unknown as Prisma.InputJsonValue,
        },
      });

      if (dto.notes) {
        await tx.labReportNote.create({
          data: {
            tenantId,
            labReportId,
            category: 'MULTI_STEP',
            body: dto.notes,
            createdBy: actorId,
          },
        });
      }

      return updated;
    });
  }
}

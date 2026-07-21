import { Injectable } from '@nestjs/common';
import { ActionWorklistStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LabReportDirectoryService } from './lab-report-directory.service';
import { ScheduleTestDto } from './dto/schedule-test.dto';
import { UpdateActionWorklistStatusDto } from './dto/update-worklist-status.dto';
import { SCHEDULED_TEST_INCLUDE } from './entities/worklist.entity';
import {
  ActiveBranchRequiredException,
  LabReportNotFoundException,
  WorklistEntryNotFoundException,
} from './exceptions/lab-report.exceptions';

/**
 * Schedule Test worklist (LABORATORY.docx §5.6, §8.5). Per CR-03, there is no
 * standalone "+ Add Schedule" creation path — rows are created only via the
 * per-test Schedule action (`schedule`), and the same fields serve Reschedule
 * (`reschedule`) from the worklist itself. Uses `ActionWorklistStatus`
 * (Pending/In Progress/Completed) — §8.5 never describes a "New" state here,
 * unlike Critical Alerts/Out of Range.
 */
@Injectable()
export class ScheduledTestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly directory: LabReportDirectoryService,
  ) {}

  private requireBranch(branchId: string | null): string {
    if (!branchId) throw new ActiveBranchRequiredException();
    return branchId;
  }

  async schedule(
    labReportId: string,
    tenantId: string,
    branchId: string | null,
    actorId: string,
    dto: ScheduleTestDto,
  ) {
    const activeBranchId = this.requireBranch(branchId);
    const report = await this.prisma.labReport.findFirst({
      where: { id: labReportId, tenantId, branchId: activeBranchId, deletedAt: null },
    });
    if (!report) throw new LabReportNotFoundException(labReportId);

    if (dto.assignedToId) {
      await this.directory.assertActiveTechnician(
        tenantId,
        activeBranchId,
        dto.assignedToId,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const scheduled = await tx.scheduledTest.create({
        data: {
          tenantId,
          branchId: activeBranchId,
          labReportId,
          status: ActionWorklistStatus.PENDING,
          scheduledAt: new Date(dto.scheduledAt),
          dispatchAt: dto.dispatchAt ? new Date(dto.dispatchAt) : undefined,
          assignedToId: dto.assignedToId,
          createdBy: actorId,
        },
        include: SCHEDULED_TEST_INCLUDE,
      });
      if (dto.notes) {
        await tx.labReportNote.create({
          data: {
            tenantId,
            labReportId,
            category: 'SCHEDULE',
            body: dto.notes,
            createdBy: actorId,
          },
        });
      }
      return scheduled;
    });
  }

  async findAll(tenantId: string, branchId: string | null) {
    const activeBranchId = this.requireBranch(branchId);
    return this.prisma.scheduledTest.findMany({
      where: { tenantId, branchId: activeBranchId, deletedAt: null },
      include: SCHEDULED_TEST_INCLUDE,
      orderBy: { scheduledAt: 'asc' },
    });
  }

  /** Reschedule — same fields as `schedule`, applied to an existing row. */
  async reschedule(
    id: string,
    tenantId: string,
    branchId: string | null,
    dto: ScheduleTestDto,
  ) {
    const activeBranchId = this.requireBranch(branchId);
    const entry = await this.prisma.scheduledTest.findFirst({
      where: { id, tenantId, branchId: activeBranchId, deletedAt: null },
    });
    if (!entry) throw new WorklistEntryNotFoundException('scheduled_test', id);

    if (dto.assignedToId) {
      await this.directory.assertActiveTechnician(
        tenantId,
        activeBranchId,
        dto.assignedToId,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.scheduledTest.update({
        where: { id },
        data: {
          scheduledAt: new Date(dto.scheduledAt),
          dispatchAt: dto.dispatchAt ? new Date(dto.dispatchAt) : undefined,
          assignedToId: dto.assignedToId,
        },
        include: SCHEDULED_TEST_INCLUDE,
      });
      if (dto.notes) {
        await tx.labReportNote.create({
          data: {
            tenantId,
            labReportId: entry.labReportId,
            category: 'SCHEDULE',
            body: dto.notes,
            createdBy: 'system',
          },
        });
      }
      return updated;
    });
  }

  async updateStatus(
    id: string,
    tenantId: string,
    branchId: string | null,
    dto: UpdateActionWorklistStatusDto,
  ) {
    const activeBranchId = this.requireBranch(branchId);
    const entry = await this.prisma.scheduledTest.findFirst({
      where: { id, tenantId, branchId: activeBranchId, deletedAt: null },
    });
    if (!entry) throw new WorklistEntryNotFoundException('scheduled_test', id);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.scheduledTest.update({
        where: { id },
        data: { status: dto.status },
      });
      if (dto.notes) {
        await tx.labReportNote.create({
          data: {
            tenantId,
            labReportId: entry.labReportId,
            category: 'SCHEDULE',
            body: dto.notes,
            createdBy: 'system',
          },
        });
      }
      return updated;
    });
  }
}

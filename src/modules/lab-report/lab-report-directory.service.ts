import { Injectable } from '@nestjs/common';
import { StaffStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TechnicianNotFoundException } from './exceptions/lab-report.exceptions';

/** AuthRole keys that identify a technician staff Person (LABORATORY.docx). */
const TECHNICIAN_ROLE_KEYS = [
  'lab_technician',
  'junior_lab_technician',
  'senior_lab_technician',
] as const;

/**
 * Validates a `ScheduledTest.assignedToId` (LABORATORY.docx §5.6 "Assign To")
 * against an active technician-role staff Person at the branch. Mirrors
 * PhlebotomistDirectoryService.assertActivePhlebotomist's pattern, matching
 * any of the three technician role keys instead of one fixed key.
 */
@Injectable()
export class LabReportDirectoryService {
  constructor(private readonly prisma: PrismaService) {}

  async assertActiveTechnician(
    tenantId: string,
    branchId: string,
    personId: string,
  ): Promise<void> {
    const profile = await this.prisma.userBranchProfile.findFirst({
      where: {
        tenantId,
        branchId,
        personId,
        deletedAt: null,
        branchStatus: StaffStatus.ACTIVE,
        authRole: { key: { in: [...TECHNICIAN_ROLE_KEYS] } },
      },
      select: { id: true },
    });
    if (!profile) throw new TechnicianNotFoundException(personId);
  }
}

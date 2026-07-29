import { BadRequestException, Injectable } from '@nestjs/common';
import { TechnicianSetting } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BranchService } from '../branch/branch.service';
import { SaveTechnicianSettingsDto } from './dto/save-technician-settings.dto';

/**
 * Per-branch Technician › Laboratory settings (Analytical TAT alert
 * thresholds + Laboratory Permissions). Mirrors `ConsoleSettingsService` for
 * its typed-column upsert pattern and `AppointmentSettingsService` for its
 * per-branch scoping: one row per branch (unique `(tenantId, branchId)`),
 * created on first access so the frontend always receives a complete
 * settings object.
 */
@Injectable()
export class TechnicianSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchService: BranchService,
  ) {}

  /**
   * Fetch the branch's settings (creating the default row if absent).
   * @throws BranchNotFoundException if the branch is missing/other tenant
   */
  async getForBranch(
    tenantId: string,
    branchId: string,
  ): Promise<TechnicianSetting> {
    await this.branchService.findById(branchId, tenantId);
    return this.prisma.technicianSetting.upsert({
      where: { tenantId_branchId: { tenantId, branchId } },
      create: { tenantId, branchId },
      update: {},
    });
  }

  /**
   * Save (upsert) the branch's settings.
   * @throws BranchNotFoundException if the branch is missing/other tenant
   */
  async saveForBranch(
    tenantId: string,
    branchId: string,
    dto: SaveTechnicianSettingsDto,
  ): Promise<TechnicianSetting> {
    await this.branchService.findById(branchId, tenantId);

    const existing = await this.prisma.technicianSetting.findUnique({
      where: { tenantId_branchId: { tenantId, branchId } },
    });
    const warning = dto.tatWarningMinutes ?? existing?.tatWarningMinutes;
    const critical = dto.tatCriticalMinutes ?? existing?.tatCriticalMinutes;
    const imminent = dto.tatImminentMinutes ?? existing?.tatImminentMinutes;
    if (
      warning !== undefined &&
      critical !== undefined &&
      imminent !== undefined &&
      !(warning > critical && critical > imminent)
    ) {
      throw new BadRequestException(
        'TAT thresholds must satisfy Warning > Critical > Imminent (minutes remaining)',
      );
    }

    return this.prisma.technicianSetting.upsert({
      where: { tenantId_branchId: { tenantId, branchId } },
      create: { tenantId, branchId, ...dto },
      update: { ...dto },
    });
  }
}

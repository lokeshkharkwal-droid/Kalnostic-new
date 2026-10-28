import { BadRequestException, Injectable } from '@nestjs/common';
import { TechnicianSetting } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BranchService } from '../branch/branch.service';
import { SaveTechnicianSettingsDto } from './dto/save-technician-settings.dto';

/**
 * Whether a branch lets the technician choose which Notes sections print: one
 * switch for a single lab test, one for a test that belongs to a lab panel.
 */
export interface NotesPrintSwitches {
  labTest: boolean;
  labPanel: boolean;
}

/** Both switches are ON until a branch turns one off. */
export const DEFAULT_NOTES_PRINT_SWITCHES: NotesPrintSwitches = {
  labTest: true,
  labPanel: true,
};

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
   * The two "choose which Notes sections print" switches of a branch: one for a
   * single lab test, one for a test on a lab panel order. Read-only: unlike
   * {@link getForBranch} it never creates the row, because it runs while a report
   * is being printed. A branch with no settings row yet has both switches ON (the
   * column defaults).
   * @param branchId the branch whose settings apply (null = no branch: defaults)
   */
  async getNotesPrintSwitches(
    tenantId: string,
    branchId: string | null,
  ): Promise<NotesPrintSwitches> {
    if (!branchId) return { ...DEFAULT_NOTES_PRINT_SWITCHES };
    const row = await this.prisma.technicianSetting.findUnique({
      where: { tenantId_branchId: { tenantId, branchId } },
      select: {
        isLabTestNotesSelectable: true,
        isLabPanelNotesSelectable: true,
      },
    });
    return {
      labTest: row?.isLabTestNotesSelectable ?? true,
      labPanel: row?.isLabPanelNotesSelectable ?? true,
    };
  }

  /**
   * The branch's two "choose which Notes sections print" switches, for the Branch
   * Settings screen. Validates the branch; never creates the row (a branch that has
   * none yet shows both ON, the column defaults).
   * @throws BranchNotFoundException if the branch is missing/other tenant
   */
  async getNotesPrintForBranch(
    tenantId: string,
    branchId: string,
  ): Promise<NotesPrintSwitches> {
    await this.branchService.findById(branchId, tenantId);
    return this.getNotesPrintSwitches(tenantId, branchId);
  }

  /**
   * Save the branch's two Notes-print switches and nothing else. These are owned by
   * the Branch Admin (Branch Settings), so they are NOT part of the Technician
   * settings save ({@link saveForBranch}). A switch left out of `switches` keeps its
   * value; the row is created with the defaults if the branch has none yet.
   * @throws BranchNotFoundException if the branch is missing/other tenant
   */
  async saveNotesPrintForBranch(
    tenantId: string,
    branchId: string,
    switches: Partial<NotesPrintSwitches>,
  ): Promise<NotesPrintSwitches> {
    await this.branchService.findById(branchId, tenantId);
    const patch = {
      ...(switches.labTest !== undefined
        ? { isLabTestNotesSelectable: switches.labTest }
        : {}),
      ...(switches.labPanel !== undefined
        ? { isLabPanelNotesSelectable: switches.labPanel }
        : {}),
    };
    const row = await this.prisma.technicianSetting.upsert({
      where: { tenantId_branchId: { tenantId, branchId } },
      create: { tenantId, branchId, ...patch },
      update: patch,
      select: {
        isLabTestNotesSelectable: true,
        isLabPanelNotesSelectable: true,
      },
    });
    return {
      labTest: row.isLabTestNotesSelectable,
      labPanel: row.isLabPanelNotesSelectable,
    };
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

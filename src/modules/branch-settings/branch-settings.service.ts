import { Injectable } from '@nestjs/common';
import { TechnicianSettingsService } from '../technician-settings/technician-settings.service';
import { SaveReportPrintingSettingsDto } from './dto/save-report-printing-settings.dto';
import { ReportPrintingSettings } from './entities/report-printing-settings.entity';

/**
 * Branch-wide settings a Branch Admin owns. Today: the report-printing switches
 * (may the technician choose which Notes sections print). The values live in the
 * branch's `technician_settings` row, which the print code already reads; this
 * service is only the Branch Admin's way to read and change them, so lab staff
 * who can edit Technician settings cannot change them.
 */
@Injectable()
export class BranchSettingsService {
  constructor(private readonly technicianSettings: TechnicianSettingsService) {}

  /**
   * The branch's report-printing settings (both ON when it has never saved any).
   * @param branchId the active branch from the token
   * @throws BranchNotFoundException if the branch is missing/other tenant
   */
  async getReportPrinting(
    tenantId: string,
    branchId: string,
  ): Promise<ReportPrintingSettings> {
    return toApi(
      await this.technicianSettings.getNotesPrintForBranch(tenantId, branchId),
    );
  }

  /**
   * Save the branch's report-printing settings; a switch left out of `dto` keeps
   * its value. Takes effect on the next print of any report held by this branch.
   * @param branchId the active branch from the token
   * @throws BranchNotFoundException if the branch is missing/other tenant
   */
  async saveReportPrinting(
    tenantId: string,
    branchId: string,
    dto: SaveReportPrintingSettingsDto,
  ): Promise<ReportPrintingSettings> {
    return toApi(
      await this.technicianSettings.saveNotesPrintForBranch(
        tenantId,
        branchId,
        {
          labTest: dto.isLabTestNotesSelectable,
          labPanel: dto.isLabPanelNotesSelectable,
        },
      ),
    );
  }
}

function toApi(s: {
  labTest: boolean;
  labPanel: boolean;
}): ReportPrintingSettings {
  return {
    isLabTestNotesSelectable: s.labTest,
    isLabPanelNotesSelectable: s.labPanel,
  };
}

import { BranchSettingsService } from './branch-settings.service';
import type { TechnicianSettingsService } from '../technician-settings/technician-settings.service';

/**
 * Branch Settings > Report Printing: the Branch Admin reads and changes the two
 * "choose which Notes sections print" switches through the Technician settings
 * service (which owns the table). The API speaks `isLabTestNotesSelectable` /
 * `isLabPanelNotesSelectable`; the print code speaks `labTest` / `labPanel`.
 */
function make() {
  const technician = {
    getNotesPrintForBranch: jest.fn(),
    saveNotesPrintForBranch: jest.fn(),
  };
  const service = new BranchSettingsService(
    technician as unknown as TechnicianSettingsService,
  );
  return { service, technician };
}

describe('BranchSettingsService', () => {
  it('reads the active branch and returns the API field names', async () => {
    const { service, technician } = make();
    technician.getNotesPrintForBranch.mockResolvedValue({
      labTest: true,
      labPanel: false,
    });
    await expect(service.getReportPrinting('t1', 'b1')).resolves.toEqual({
      isLabTestNotesSelectable: true,
      isLabPanelNotesSelectable: false,
    });
    expect(technician.getNotesPrintForBranch).toHaveBeenCalledWith('t1', 'b1');
  });

  it('saves both switches for the branch it is given and returns the saved state', async () => {
    const { service, technician } = make();
    technician.saveNotesPrintForBranch.mockResolvedValue({
      labTest: false,
      labPanel: false,
    });
    await expect(
      service.saveReportPrinting('t1', 'b1', {
        isLabTestNotesSelectable: false,
        isLabPanelNotesSelectable: false,
      }),
    ).resolves.toEqual({
      isLabTestNotesSelectable: false,
      isLabPanelNotesSelectable: false,
    });
    expect(technician.saveNotesPrintForBranch).toHaveBeenCalledWith(
      't1',
      'b1',
      { labTest: false, labPanel: false },
    );
  });

  it('a switch left out of the body is passed on as undefined, so it keeps its value', async () => {
    const { service, technician } = make();
    technician.saveNotesPrintForBranch.mockResolvedValue({
      labTest: true,
      labPanel: true,
    });
    await service.saveReportPrinting('t1', 'b1', {
      isLabPanelNotesSelectable: true,
    });
    expect(technician.saveNotesPrintForBranch).toHaveBeenCalledWith(
      't1',
      'b1',
      { labTest: undefined, labPanel: true },
    );
  });

  it('a missing branch error from the Technician service is not swallowed', async () => {
    const { service, technician } = make();
    technician.getNotesPrintForBranch.mockRejectedValue(new Error('no branch'));
    await expect(service.getReportPrinting('t1', '')).rejects.toThrow(
      'no branch',
    );
  });
});

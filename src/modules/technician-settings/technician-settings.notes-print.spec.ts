import { TechnicianSettingsService } from './technician-settings.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { BranchService } from '../branch/branch.service';

/**
 * The two Notes-print switches in `technician_settings`: read without creating a
 * row, saved on their own (the Technician settings save no longer carries them).
 */
function make(
  row: {
    isLabTestNotesSelectable: boolean;
    isLabPanelNotesSelectable: boolean;
  } | null = null,
) {
  const upsert = jest.fn((args: { create: object; update: object }) =>
    Promise.resolve({
      isLabTestNotesSelectable: true,
      isLabPanelNotesSelectable: true,
      ...(row ?? {}),
      ...args.update,
    }),
  );
  const findUnique = jest.fn().mockResolvedValue(row);
  const findById = jest.fn().mockResolvedValue({ id: 'b1' });
  const service = new TechnicianSettingsService(
    { technicianSetting: { upsert, findUnique } } as unknown as PrismaService,
    { findById } as unknown as BranchService,
  );
  return { service, upsert, findUnique, findById };
}

describe('TechnicianSettingsService Notes-print switches', () => {
  it('reading checks the branch and never creates a row', async () => {
    const { service, upsert, findById } = make(null);
    await expect(service.getNotesPrintForBranch('t1', 'b1')).resolves.toEqual({
      labTest: true,
      labPanel: true,
    });
    expect(findById).toHaveBeenCalledWith('b1', 't1');
    expect(upsert).not.toHaveBeenCalled();
  });

  it('reading returns what the branch saved', async () => {
    const { service } = make({
      isLabTestNotesSelectable: false,
      isLabPanelNotesSelectable: true,
    });
    await expect(service.getNotesPrintForBranch('t1', 'b1')).resolves.toEqual({
      labTest: false,
      labPanel: true,
    });
  });

  it('saving writes only the two switches that were given', async () => {
    const { service, upsert } = make({
      isLabTestNotesSelectable: true,
      isLabPanelNotesSelectable: true,
    });
    await service.saveNotesPrintForBranch('t1', 'b1', { labPanel: false });
    const args = upsert.mock.calls[0]![0] as {
      where: object;
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    expect(args.where).toEqual({
      tenantId_branchId: { tenantId: 't1', branchId: 'b1' },
    });
    expect(args.update).toEqual({ isLabPanelNotesSelectable: false });
    expect(args.create).toEqual({
      tenantId: 't1',
      branchId: 'b1',
      isLabPanelNotesSelectable: false,
    });
  });

  it('saving returns the resulting pair, keeping the switch that was left out', async () => {
    const { service } = make({
      isLabTestNotesSelectable: false,
      isLabPanelNotesSelectable: true,
    });
    await expect(
      service.saveNotesPrintForBranch('t1', 'b1', { labPanel: false }),
    ).resolves.toEqual({ labTest: false, labPanel: false });
  });

  it('saving for a branch that is missing writes nothing', async () => {
    const { service, upsert, findById } = make(null);
    findById.mockRejectedValue(new Error('branch not found'));
    await expect(
      service.saveNotesPrintForBranch('t1', 'nope', { labTest: false }),
    ).rejects.toThrow('branch not found');
    expect(upsert).not.toHaveBeenCalled();
  });
});

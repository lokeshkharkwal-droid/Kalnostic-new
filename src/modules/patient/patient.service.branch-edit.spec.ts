import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { PtCategoryService } from '../pt-category/pt-category.service';
import { ExternalIdService } from '../registration-settings/external-id.service';
import { PatientService } from './patient.service';
import { PatientOtherBranchException } from './exceptions/patient.exceptions';

/**
 * Patients are tenant-wide (listed, searchable and editable from every branch),
 * but the per-branch PT category is owned by the registration branch — a
 * cross-branch edit silently keeps it rather than overwriting. Deletes are still
 * restricted to the registration branch. Tenant-level profiles (no active
 * branch) and unassigned patients are exempt.
 */
describe('PatientService — cross-branch edits keep the PT category', () => {
  let prisma: {
    patient: { findFirst: jest.Mock; update: jest.Mock };
    medicalHistory: { updateMany: jest.Mock };
    patientFamilyLink: { updateMany: jest.Mock };
    withTenant: jest.Mock;
  };
  let findCategory: jest.Mock;
  let service: PatientService;
  let existing: Record<string, unknown>;

  beforeEach(() => {
    existing = {
      id: 'p1',
      tenantId: 't1',
      branchId: 'branch-A',
      ptCategoryId: 'cat-A',
    };
    prisma = {
      patient: {
        findFirst: jest.fn().mockImplementation(() => existing),
        update: jest.fn().mockResolvedValue({ id: 'p1' }),
      },
      medicalHistory: { updateMany: jest.fn() },
      patientFamilyLink: { updateMany: jest.fn() },
      withTenant: jest.fn((_t: string, fn: (tx: unknown) => unknown) =>
        fn(prisma),
      ),
    };
    // Validation of a changed category against the caller's branch.
    findCategory = jest.fn().mockResolvedValue({});
    service = new PatientService(
      prisma as unknown as PrismaService,
      { findById: findCategory } as unknown as PtCategoryService,
      {} as unknown as ExternalIdService,
      { emitAsync: jest.fn() } as unknown as EventEmitter2,
    );
  });

  const updatedData = (): Record<string, unknown> =>
    (
      prisma.patient.update.mock.calls as { data: Record<string, unknown> }[][]
    )[0]![0]!.data;
  const fromBranch = (branchId: string | null) => ({ branchId, actorId: 'u1' });

  describe('update', () => {
    it("edits other fields from another branch but keeps the patient's PT category", async () => {
      await service.update(
        'p1',
        't1',
        { firstName: 'Rajesh', ptCategoryId: 'cat-B' },
        fromBranch('branch-B'),
      );
      // The cross-branch PT category is ignored (not validated, not written),
      // while the rest of the edit is applied.
      expect(findCategory).not.toHaveBeenCalled();
      expect(updatedData()).toMatchObject({ firstName: 'Rajesh' });
      expect(updatedData()).not.toHaveProperty('ptCategoryId');
    });

    it("changes the category from the patient's own branch", async () => {
      await service.update(
        'p1',
        't1',
        { ptCategoryId: 'cat-A2' },
        fromBranch('branch-A'),
      );
      expect(findCategory).toHaveBeenCalledWith('cat-A2', 't1', 'branch-A');
      expect(updatedData()).toMatchObject({ ptCategoryId: 'cat-A2' });
    });

    it("replaces another branch's category from the patient's own branch", async () => {
      existing = { ...existing, ptCategoryId: 'cat-B' };
      await service.update(
        'p1',
        't1',
        { ptCategoryId: 'cat-A' },
        fromBranch('branch-A'),
      );
      expect(updatedData()).toMatchObject({ ptCategoryId: 'cat-A' });
    });

    it('clears the category from its own branch', async () => {
      await service.update(
        'p1',
        't1',
        { ptCategoryId: null },
        fromBranch('branch-A'),
      );
      expect(updatedData()).toMatchObject({ ptCategoryId: null });
    });

    it('accepts the unchanged category without re-validating it', async () => {
      await service.update(
        'p1',
        't1',
        { firstName: 'R', ptCategoryId: 'cat-A' },
        fromBranch('branch-A'),
      );
      expect(findCategory).not.toHaveBeenCalled();
      expect(updatedData()).not.toHaveProperty('ptCategoryId');
      expect(updatedData()).toMatchObject({ firstName: 'R' });
    });

    it('lets a tenant-level profile (no active branch) edit any patient', async () => {
      await service.update('p1', 't1', { firstName: 'R' }, fromBranch(null));
      expect(updatedData()).toMatchObject({ firstName: 'R' });
    });

    it('lets any branch edit a patient with no registration branch', async () => {
      existing = { ...existing, branchId: null };
      await service.update(
        'p1',
        't1',
        { firstName: 'R' },
        fromBranch('branch-B'),
      );
      expect(updatedData()).toMatchObject({ firstName: 'R' });
    });
  });

  describe('remove', () => {
    it('rejects a delete from another branch and deletes nothing', async () => {
      await expect(
        service.remove('p1', 't1', 'branch-B'),
      ).rejects.toBeInstanceOf(PatientOtherBranchException);
      expect(prisma.withTenant).not.toHaveBeenCalled();
    });

    it("deletes from the patient's own branch", async () => {
      await service.remove('p1', 't1', 'branch-A');
      expect(prisma.patient.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'p1' } }),
      );
    });

    it('lets a tenant-level profile delete any patient', async () => {
      await service.remove('p1', 't1', null);
      expect(prisma.patient.update).toHaveBeenCalled();
    });
  });
});

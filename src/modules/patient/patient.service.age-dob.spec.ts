import { EventEmitter2 } from '@nestjs/event-emitter';
import { AgeType, ExternalIdFormat } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PtCategoryService } from '../pt-category/pt-category.service';
import { ExternalIdService } from '../registration-settings/external-id.service';
import { PatientService } from './patient.service';

/**
 * An age typed WITHOUT a date of birth is turned into one on the backend (today on the
 * tenant's clock minus the age), so the age can be worked out afresh later instead of
 * staying a frozen number. An age sent back UNCHANGED must never be converted again —
 * Create Order re-saves the patient with the same age on every order.
 */
describe('PatientService — an age typed without a date of birth', () => {
  const NOW = '2026-10-13T10:00:00Z'; // 15:30 on 13 Oct in India
  const iso = (d: unknown) =>
    d instanceof Date ? d.toISOString().slice(0, 10) : d;

  let tx: {
    patient: { create: jest.Mock };
    patientFamilyLink: { create: jest.Mock };
    person: { create: jest.Mock };
    medicalHistory: { createMany: jest.Mock; findMany: jest.Mock };
  };
  let prisma: {
    withTenant: jest.Mock;
    tenant: { findUnique: jest.Mock };
    person: { findFirst: jest.Mock };
    patient: { findFirst: jest.Mock; update: jest.Mock };
  };
  let service: PatientService;
  let existing: Record<string, unknown>;

  const build = (timezone?: string) => {
    tx = {
      patient: { create: jest.fn().mockResolvedValue({ id: 'new' }) },
      patientFamilyLink: { create: jest.fn().mockResolvedValue({ id: 'l1' }) },
      person: { create: jest.fn().mockResolvedValue({ id: 'per1' }) },
      medicalHistory: {
        createMany: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    prisma = {
      withTenant: jest.fn((_t: string, fn: (t: unknown) => unknown) => fn(tx)),
      person: { findFirst: jest.fn().mockResolvedValue(null) },
      tenant: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ settings: timezone ? { timezone } : null }),
      },
      patient: {
        findFirst: jest.fn().mockImplementation(() => existing),
        update: jest.fn().mockResolvedValue({ id: 'p1' }),
      },
    };
    service = new PatientService(
      prisma as unknown as PrismaService,
      {} as unknown as PtCategoryService,
      {
        getConfiguredFormat: jest.fn().mockResolvedValue(ExternalIdFormat.NONE),
      } as unknown as ExternalIdService,
      { emitAsync: jest.fn() } as unknown as EventEmitter2,
    );
  };

  const createdData = (): Record<string, unknown> =>
    (
      tx.patient.create.mock.calls as { data: Record<string, unknown> }[][]
    )[0]![0]!.data;
  const updatedData = (): Record<string, unknown> =>
    (
      prisma.patient.update.mock.calls as { data: Record<string, unknown> }[][]
    )[0]![0]!.data;

  // `isFamilyMember` skips the shared-identity step, keeping these tests on the date of birth alone.
  const ctx = { branchId: 'b1', actorId: 'u1', isFamilyMember: true };
  const base = { firstName: 'Jane', mobile: '9876543210', umId: 'U1' };

  beforeEach(() => {
    jest.useFakeTimers({
      now: new Date(NOW),
      doNotFake: [
        'nextTick',
        'setImmediate',
        'clearImmediate',
        'setInterval',
        'clearInterval',
        'setTimeout',
        'clearTimeout',
        'queueMicrotask',
        'performance',
        'hrtime',
      ],
    });
    existing = {
      id: 'p1',
      tenantId: 't1',
      age: 34,
      ageType: AgeType.YEARS,
      dateOfBirth: null,
    };
    build('Asia/Kolkata');
  });

  afterEach(() => jest.useRealTimers());

  describe('create', () => {
    it('saves today minus the age as the date of birth', async () => {
      await service.create(
        't1',
        { ...base, age: 20, ageType: AgeType.YEARS },
        ctx,
      );
      expect(iso(createdData().dateOfBirth)).toBe('2006-10-13');
      expect(createdData().age).toBe(20); // the typed age is kept too
    });

    it('works for a baby in days and in months', async () => {
      await service.create(
        't1',
        { ...base, age: 30, ageType: AgeType.DAYS },
        ctx,
      );
      expect(iso(createdData().dateOfBirth)).toBe('2026-09-13');
      build('Asia/Kolkata');
      await service.create(
        't1',
        { ...base, age: 3, ageType: AgeType.MONTHS },
        ctx,
      );
      expect(iso(createdData().dateOfBirth)).toBe('2026-07-13');
    });

    it('reads "today" on the tenant clock, not the UTC day', async () => {
      jest.setSystemTime(new Date('2026-10-12T20:00:00Z')); // already 13 Oct in India
      await service.create(
        't1',
        { ...base, age: 20, ageType: AgeType.YEARS },
        ctx,
      );
      expect(iso(createdData().dateOfBirth)).toBe('2006-10-13');
      build('UTC');
      await service.create(
        't1',
        { ...base, age: 20, ageType: AgeType.YEARS },
        ctx,
      );
      expect(iso(createdData().dateOfBirth)).toBe('2006-10-12');
    });

    it('a date of birth that was typed is kept exactly as sent', async () => {
      await service.create(
        't1',
        { ...base, age: 20, ageType: AgeType.YEARS, dateOfBirth: '1999-05-05' },
        ctx,
      );
      expect(iso(createdData().dateOfBirth)).toBe('1999-05-05');
      expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
    });

    it('the shared platform identity (Person) never gets a date of birth made from an age', async () => {
      // a normal registration (not a family member) is backed by a brand-new shared Person
      const normal = { branchId: 'b1', actorId: 'u1' };
      await service.create(
        't1',
        { ...base, mobile: '+919876543210', age: 20, ageType: AgeType.YEARS },
        normal,
      );
      const personData = (
        tx.person.create.mock.calls as { data: Record<string, unknown> }[][]
      )[0]![0]!.data;
      expect(personData.dateOfBirth).toBeNull();
      expect(iso(createdData().dateOfBirth)).toBe('2006-10-13'); // the patient row still gets it
    });

    it('the shared platform identity does get a date of birth the user really entered', async () => {
      const normal = { branchId: 'b1', actorId: 'u1' };
      await service.create(
        't1',
        {
          ...base,
          mobile: '+919876543210',
          age: 20,
          dateOfBirth: '1999-05-05',
        },
        normal,
      );
      const personData = (
        tx.person.create.mock.calls as { data: Record<string, unknown> }[][]
      )[0]![0]!.data;
      expect(iso(personData.dateOfBirth)).toBe('1999-05-05');
    });

    it('no age and no date of birth stays empty', async () => {
      await service.create('t1', base, ctx);
      expect(createdData().dateOfBirth).toBeNull();
    });

    it('an age of 0 is a real age (born today)', async () => {
      await service.create(
        't1',
        { ...base, age: 0, ageType: AgeType.DAYS },
        ctx,
      );
      expect(iso(createdData().dateOfBirth)).toBe('2026-10-13');
    });

    it('an impossible age is stored as typed with no date of birth (not an error)', async () => {
      await service.create(
        't1',
        { ...base, age: 500, ageType: AgeType.YEARS },
        ctx,
      );
      expect(createdData().dateOfBirth).toBeNull();
    });

    it('falls back to the Indian clock when the tenant has no time zone saved', async () => {
      jest.setSystemTime(new Date('2026-10-12T20:00:00Z'));
      build(undefined);
      await service.create(
        't1',
        { ...base, age: 20, ageType: AgeType.YEARS },
        ctx,
      );
      expect(iso(createdData().dateOfBirth)).toBe('2006-10-13');
    });
  });

  describe('update', () => {
    it('an age that CHANGED (no date of birth sent) becomes a date of birth', async () => {
      await service.update('p1', 't1', { age: 36 });
      expect(iso(updatedData().dateOfBirth)).toBe('1990-10-13');
    });

    it('an age sent back UNCHANGED does not touch the date of birth (the clock must not restart)', async () => {
      await service.update('p1', 't1', { age: 34, ageType: AgeType.YEARS });
      expect(updatedData()).not.toHaveProperty('dateOfBirth');
    });

    it('a changed unit counts as a change', async () => {
      await service.update('p1', 't1', { age: 34, ageType: AgeType.MONTHS });
      expect(iso(updatedData().dateOfBirth)).toBe('2023-12-13');
    });

    it('a patient with no age yet who is given one gets a date of birth', async () => {
      existing = { ...existing, age: null, ageType: null };
      await service.update('p1', 't1', { age: 10 });
      expect(iso(updatedData().dateOfBirth)).toBe('2016-10-13');
    });

    it('an age change on a patient who already has a date of birth replaces it (kept consistent)', async () => {
      existing = { ...existing, dateOfBirth: new Date('1992-01-01') };
      await service.update('p1', 't1', { age: 40 });
      expect(iso(updatedData().dateOfBirth)).toBe('1986-10-13');
    });

    it('a date of birth that was sent wins over an age that also changed', async () => {
      await service.update('p1', 't1', { age: 36, dateOfBirth: '1990-02-02' });
      expect(iso(updatedData().dateOfBirth)).toBe('1990-02-02');
    });

    it('a request with no age at all leaves the date of birth alone', async () => {
      await service.update('p1', 't1', { firstName: 'Janet' });
      expect(updatedData()).not.toHaveProperty('dateOfBirth');
    });
  });

  describe('addFamilyMember', () => {
    const member = {
      name: 'Kid',
      mobile: '9876543210',
      relationship: 'SON' as never,
    };

    it("saves the date of birth the member's age (in years) implies", async () => {
      await service.addFamilyMember(
        't1',
        'p1',
        { ...member, age: 8 },
        { branchId: 'b1' },
      );
      expect(iso(createdData().dateOfBirth)).toBe('2018-10-13');
      expect(createdData().age).toBe(8);
    });

    it('no age → no date of birth', async () => {
      await service.addFamilyMember('t1', 'p1', member, { branchId: 'b1' });
      expect(createdData().dateOfBirth).toBeNull();
    });
  });
});

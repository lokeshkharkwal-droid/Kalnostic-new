import { PrismaService } from '../../prisma/prisma.service';
import { PatientScopeService } from './patient-scope.service';

/** The first argument of a mock's first call, typed (a bare `mock.calls[0][0]` is `any`). */
function firstCallArg<T>(fn: jest.Mock): T {
  const call = fn.mock.calls[0] as unknown[] | undefined;
  return call?.[0] as T;
}

const TENANT = 'tenant-1';
const PERSON = 'person-1';

const patientRow = (id: string, firstName: string) => ({
  id,
  salutation: null,
  firstName,
  middleName: null,
  lastName: 'Kumar',
});

function build(opts: {
  own?: ReturnType<typeof patientRow>[];
  links?: { memberId: string; relationship: string }[];
  members?: ReturnType<typeof patientRow>[];
}) {
  const prisma = {
    patient: {
      findMany: jest
        .fn()
        .mockResolvedValueOnce(opts.own ?? [])
        .mockResolvedValueOnce(opts.members ?? []),
    },
    patientFamilyLink: {
      findMany: jest.fn().mockResolvedValue(opts.links ?? []),
    },
  };
  return {
    service: new PatientScopeService(prisma as unknown as PrismaService),
    prisma,
  };
}

describe('PatientScopeService', () => {
  it('returns nothing, and looks up no family, when the person has no patient record in the tenant', async () => {
    const { service, prisma } = build({ own: [] });
    expect(await service.getViewablePatients(TENANT, PERSON)).toEqual([]);
    expect(prisma.patientFamilyLink.findMany).not.toHaveBeenCalled();
  });

  it("lists the person's own record first, then linked family members with their relationship", async () => {
    const { service } = build({
      own: [patientRow('p-self', 'Sahu')],
      links: [{ memberId: 'p-shree', relationship: 'DAUGHTER' }],
      members: [patientRow('p-shree', 'Shree')],
    });
    expect(await service.getViewablePatients(TENANT, PERSON)).toEqual([
      {
        patientId: 'p-self',
        name: 'Sahu Kumar',
        relationship: 'SELF',
        isSelf: true,
      },
      {
        patientId: 'p-shree',
        name: 'Shree Kumar',
        relationship: 'DAUGHTER',
        isSelf: false,
      },
    ]);
  });

  it("scopes the family lookup to the tenant and to the person's own patient rows only", async () => {
    const { service, prisma } = build({
      own: [patientRow('p-self', 'Sahu')],
      links: [{ memberId: 'p-shree', relationship: 'DAUGHTER' }],
      members: [patientRow('p-shree', 'Shree')],
    });
    await service.getViewablePatients(TENANT, PERSON);
    expect(
      firstCallArg<{ where: unknown }>(prisma.patientFamilyLink.findMany).where,
    ).toEqual({
      tenantId: TENANT,
      patientId: { in: ['p-self'] },
      deletedAt: null,
    });
  });

  it('narrows to one viewable patient when asked', async () => {
    const { service } = build({
      own: [patientRow('p-self', 'Sahu')],
      links: [{ memberId: 'p-shree', relationship: 'DAUGHTER' }],
      members: [patientRow('p-shree', 'Shree')],
    });
    expect(
      await service.resolveScopedPatientIds(TENANT, PERSON, 'p-shree'),
    ).toEqual(['p-shree']);
  });

  it("never widens the scope: a patient id outside the person's own and family records gives nothing", async () => {
    const { service } = build({
      own: [patientRow('p-self', 'Sahu')],
      links: [],
      members: [],
    });
    expect(
      await service.resolveScopedPatientIds(TENANT, PERSON, 'someone-else'),
    ).toEqual([]);
  });
});

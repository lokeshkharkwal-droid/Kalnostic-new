import { OrderSampleService } from './accession-sample.service';
import { SampleDepartmentForbiddenException } from './exceptions/accession.exceptions';

/**
 * Regression coverage for the department restriction on COLLECT (task §2/§3):
 * the same rule that scopes the Accession In-House / Technician Reporting listings
 * must also prevent collecting a sample outside the caller's department scope —
 * for standalone tests AND panel-member tests (each sample carries its own
 * `departmentId`). These exercise the write-side guard directly.
 */
describe('OrderSampleService department collect guard', () => {
  type Sample = { id: string; departmentId: string | null };

  function makeService(samples: Sample[], scopeIds: string[]) {
    const svc = Object.create(
      OrderSampleService.prototype,
    ) as OrderSampleService;
    Object.assign(svc, {
      prisma: {
        orderSample: {
          findMany: jest.fn().mockResolvedValue(samples),
        },
      },
      userDepartmentScope: {
        resolveDepartmentIds: jest.fn().mockResolvedValue(scopeIds),
      },
    });
    return svc;
  }

  it('allows collecting samples whose department is in the caller scope', async () => {
    const svc = makeService(
      [
        { id: 's1', departmentId: 'BIOCHEM' },
        { id: 's2', departmentId: 'BIOCHEM' },
      ],
      ['BIOCHEM'],
    );
    await expect(
      svc.assertSamplesInDepartmentScope('t1', 'p1', ['s1', 's2']),
    ).resolves.toBeUndefined();
  });

  it('allows unassigned (null-department) samples for everyone', async () => {
    const svc = makeService([{ id: 's1', departmentId: null }], []);
    await expect(
      svc.assertSamplesInDepartmentScope('t1', 'p1', ['s1']),
    ).resolves.toBeUndefined();
  });

  it('rejects a sample whose department is outside the caller scope (panel member case)', async () => {
    // Panel member in ENDOCRINE; caller only in BIOCHEM.
    const svc = makeService(
      [
        { id: 's1', departmentId: 'BIOCHEM' },
        { id: 's2', departmentId: 'ENDOCRINE' },
      ],
      ['BIOCHEM'],
    );
    await expect(
      svc.assertSamplesInDepartmentScope('t1', 'p1', ['s1', 's2']),
    ).rejects.toBeInstanceOf(SampleDepartmentForbiddenException);
  });

  it('a user mapped to NO department may collect only unassigned samples', async () => {
    const svc = makeService([{ id: 's1', departmentId: 'BIOCHEM' }], []);
    await expect(
      svc.assertSamplesInDepartmentScope('t1', 'p1', ['s1']),
    ).rejects.toBeInstanceOf(SampleDepartmentForbiddenException);
  });

  it('a null personId is treated as mapped to no department', async () => {
    const svc = makeService([{ id: 's1', departmentId: 'BIOCHEM' }], []);
    const resolve = (
      svc as unknown as {
        userDepartmentScope: { resolveDepartmentIds: jest.Mock };
      }
    ).userDepartmentScope.resolveDepartmentIds;
    await expect(
      svc.assertSamplesInDepartmentScope('t1', null, ['s1']),
    ).rejects.toBeInstanceOf(SampleDepartmentForbiddenException);
    // Scope is never resolved for a null caller — they are simply department-less.
    expect(resolve).not.toHaveBeenCalled();
  });

  it('is a no-op on an empty id set (does not even resolve scope)', async () => {
    const svc = makeService([], ['BIOCHEM']);
    const resolve = (
      svc as unknown as {
        userDepartmentScope: { resolveDepartmentIds: jest.Mock };
      }
    ).userDepartmentScope.resolveDepartmentIds;
    await expect(
      svc.assertSamplesInDepartmentScope('t1', 'p1', []),
    ).resolves.toBeUndefined();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('per-order-item guard resolves the item samples then applies the same rule', async () => {
    const svc = makeService(
      [
        { id: 's1', departmentId: 'BIOCHEM' },
        { id: 's2', departmentId: 'ENDOCRINE' },
      ],
      ['BIOCHEM'],
    );
    await expect(
      svc.assertOrderItemSamplesInDepartmentScope('t1', 'p1', 'item1'),
    ).rejects.toBeInstanceOf(SampleDepartmentForbiddenException);
  });
});

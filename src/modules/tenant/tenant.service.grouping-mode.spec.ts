import {
  AccessionGroupingMode,
  AuditAction,
  AuditModule,
} from '@prisma/client';
import { TenantService, GroupingModeActor } from './tenant.service';
import {
  TenantGroupingModeBusyException,
  TenantNotFoundException,
} from './exceptions/tenant.exceptions';

/**
 * Changing the grouping mode in Accession Settings sets the mode NEW orders take. It must never touch a
 * barcode (they are on printed labels, in transfers and in the analyzer), must read the old mode under the
 * tenant row lock, and must write its audit row (old + new mode) in the SAME transaction.
 */

const ACTOR: GroupingModeActor = {
  personId: 'p1',
  branchId: 'b1',
  roleKey: 'business_admin',
  roleLabel: 'Business Admin',
  ipAddress: '10.0.0.1',
};

function build(
  opts: {
    tenantExists?: boolean;
    currentMode?: AccessionGroupingMode;
    auditFails?: boolean;
    lockTimesOut?: Error;
  } = {},
) {
  const current =
    opts.currentMode ?? AccessionGroupingMode.DEPARTMENT_SAMPLE_NAME;
  const calls: string[] = [];
  const tx = {
    $executeRaw: jest.fn().mockImplementation(() => {
      calls.push('lock-timeout-set');
      return Promise.resolve(1);
    }),
    tenant: {
      findFirst: jest
        .fn()
        .mockImplementation(() =>
          Promise.resolve(opts.tenantExists === false ? null : { id: 't1' }),
        ),
      update: jest
        .fn()
        .mockImplementation(
          (a: { data: { groupingMode?: string; updatedAt?: Date } }) => {
            if (opts.lockTimesOut && !a.data.groupingMode)
              return Promise.reject(opts.lockTimesOut);
            calls.push(a.data.groupingMode ? 'save-mode' : 'lock');
            return Promise.resolve({ id: 't1', groupingMode: current });
          },
        ),
    },
    // the wipe used to live here: it must never be called
    orderSample: { updateMany: jest.fn() },
    order: { updateMany: jest.fn() },
  };
  const auditService = {
    recordInTx: jest.fn().mockImplementation(() => {
      calls.push('audit');
      return opts.auditFails
        ? Promise.reject(new Error('audit insert failed'))
        : Promise.resolve();
    }),
  };
  const prisma = {
    withTenant: jest
      .fn()
      .mockImplementation((_t: string, fn: (t: unknown) => Promise<unknown>) =>
        fn(tx),
      ),
  };
  const service = Object.create(
    TenantService.prototype,
  ) as unknown as TenantService & Record<string, unknown>;
  service['prisma'] = prisma;
  service['auditService'] = auditService;
  return { service, tx, auditService, prisma, calls };
}

describe('TenantService.updateGroupingMode', () => {
  it('never touches a barcode or an existing order (the old wipe is gone)', async () => {
    const m = build();
    await m.service.updateGroupingMode(
      't1',
      AccessionGroupingMode.ORDER,
      ACTOR,
    );
    expect(m.tx.orderSample.updateMany).not.toHaveBeenCalled();
    expect(m.tx.order.updateMany).not.toHaveBeenCalled();
  });

  it('locks the tenant row FIRST, then saves the mode, then writes the audit row - all in the one transaction', async () => {
    const m = build();
    const r = await m.service.updateGroupingMode(
      't1',
      AccessionGroupingMode.ORDER,
      ACTOR,
    );
    expect(r).toEqual({ groupingMode: AccessionGroupingMode.ORDER });
    expect(m.prisma.withTenant).toHaveBeenCalledTimes(1);
    expect(m.calls).toEqual(['lock-timeout-set', 'lock', 'save-mode', 'audit']);
    // the audit row goes through the SAME transaction client as the update
    const recorded = m.auditService.recordInTx.mock.calls as unknown[][];
    expect(recorded[0]![0]).toBe(m.tx);
  });

  it('records WHO changed it, FROM what and TO what', async () => {
    const m = build({ currentMode: AccessionGroupingMode.DEPARTMENT });
    await m.service.updateGroupingMode(
      't1',
      AccessionGroupingMode.ORDER,
      ACTOR,
    );
    const input = (
      m.auditService.recordInTx.mock.calls as unknown[][]
    )[0]![1] as Record<string, unknown>;
    expect(input).toMatchObject({
      tenantId: 't1',
      branchId: 'b1',
      module: AuditModule.TENANT,
      action: AuditAction.UPDATE,
      actorPersonId: 'p1',
      actorRoleKey: 'business_admin',
      actorRoleLabel: 'Business Admin',
      ipAddress: '10.0.0.1',
      resourceId: 't1',
      metadata: { oldMode: 'DEPARTMENT', newMode: 'ORDER' },
    });
    expect(String(input['description'])).toContain('from DEPARTMENT to ORDER');
    expect(String(input['description'])).toContain('new orders only');
  });

  it('saving the mode the tenant already has changes and records nothing', async () => {
    const m = build({ currentMode: AccessionGroupingMode.ORDER });
    const r = await m.service.updateGroupingMode(
      't1',
      AccessionGroupingMode.ORDER,
      ACTOR,
    );
    expect(r).toEqual({ groupingMode: AccessionGroupingMode.ORDER });
    expect(m.calls).toEqual(['lock-timeout-set', 'lock']); // no second update, no audit row
    expect(m.auditService.recordInTx).not.toHaveBeenCalled();
  });

  it('if the audit row cannot be written the whole change fails (so it can never be saved without its record)', async () => {
    const m = build({ auditFails: true });
    await expect(
      m.service.updateGroupingMode('t1', AccessionGroupingMode.ORDER, ACTOR),
    ).rejects.toThrow('audit insert failed');
  });

  it('without an actor (an internal caller) it still changes the mode and writes no audit row', async () => {
    const m = build();
    await m.service.updateGroupingMode('t1', AccessionGroupingMode.ORDER);
    expect(m.calls).toEqual(['lock-timeout-set', 'lock', 'save-mode']);
    expect(m.auditService.recordInTx).not.toHaveBeenCalled();
  });

  it('a missing or deleted tenant is reported, and nothing is written', async () => {
    const m = build({ tenantExists: false });
    await expect(
      m.service.updateGroupingMode('t1', AccessionGroupingMode.ORDER, ACTOR),
    ).rejects.toBeInstanceOf(TenantNotFoundException);
    expect(m.tx.tenant.update).not.toHaveBeenCalled();
    expect(m.auditService.recordInTx).not.toHaveBeenCalled();
  });

  it('sets a short lock wait BEFORE it asks for the tenant-row lock', async () => {
    const m = build();
    await m.service.updateGroupingMode(
      't1',
      AccessionGroupingMode.ORDER,
      ACTOR,
    );
    expect(m.calls.indexOf('lock-timeout-set')).toBeLessThan(
      m.calls.indexOf('lock'),
    );
    const raw = m.tx.$executeRaw.mock.calls as unknown[][];
    expect(raw[0]!.slice(1)).toEqual(['3000']); // 3 s, under Prisma's own 5 s transaction timeout
  });

  it('when the tenant row stays locked (Postgres 55P03) the admin gets a clear "busy, try again", not a 500, and nothing is saved', async () => {
    const m = build({
      lockTimesOut: Object.assign(
        new Error('canceling statement due to lock timeout'),
        { code: 'P2010', meta: { code: '55P03' } },
      ),
    });
    const err: unknown = await m.service
      .updateGroupingMode('t1', AccessionGroupingMode.ORDER, ACTOR)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TenantGroupingModeBusyException);
    expect((err as TenantGroupingModeBusyException).getStatus()).toBe(409);
    expect(m.calls).not.toContain('save-mode');
    expect(m.auditService.recordInTx).not.toHaveBeenCalled();
  });

  it('any other database error is passed through unchanged (it is not disguised as "busy")', async () => {
    const m = build({ lockTimesOut: new Error('connection reset') });
    await expect(
      m.service.updateGroupingMode('t1', AccessionGroupingMode.ORDER, ACTOR),
    ).rejects.toThrow('connection reset');
  });
});

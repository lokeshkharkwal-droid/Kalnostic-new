import { MessagingChannel } from '@prisma/client';
import { TemplateService } from './template.service';

/**
 * Unit tests for messaging-template SELECTION — the logic that decides which
 * `Template` a notification uses. These assert the two guarantees the amn.csv
 * test set cares about: a template is chosen strictly by (feature + channel +
 * scope), never by name/first-row, and selection is fully deterministic.
 *
 * Prisma is stubbed: `withTenant(id, cb)` runs `cb(tx)`, and `tx.template.findFirst`
 * is driven by a per-test row set filtered exactly like the real query, so the
 * assertions exercise the service's own where/orderBy/scope-cascade construction.
 */
interface Row {
  id: string;
  tenantId: string | null;
  branchId: string | null;
  preference: MessagingChannel;
  feature: string;
  isActive: boolean;
  isDefault: boolean;
  updatedAt: Date;
  deletedAt: Date | null;
  displayTitle: string;
}

const TENANT = 't1';
const BRANCH = 'b1';

function makeService(rows: Row[]): TemplateService {
  const findFirst = jest.fn(
    ({
      where,
      orderBy,
    }: {
      where: {
        tenantId?: string | null;
        branchId?: string | null;
        preference: MessagingChannel;
        feature: string;
        isActive: boolean;
        deletedAt: null;
      };
      orderBy: Record<string, 'asc' | 'desc'>[];
    }) => {
      const matched = rows
        .filter(
          (r) =>
            r.tenantId === (where.tenantId ?? null) &&
            // branchId is only present in the where when the scope sets it
            ('branchId' in where ? r.branchId === where.branchId : true) &&
            r.preference === where.preference &&
            r.feature === where.feature &&
            r.isActive === where.isActive &&
            r.deletedAt === where.deletedAt,
        )
        .sort((a, b) => {
          // Mirror orderBy [isDefault desc, updatedAt desc, id asc]
          if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
          if (a.updatedAt.getTime() !== b.updatedAt.getTime())
            return b.updatedAt.getTime() - a.updatedAt.getTime();
          return a.id < b.id ? -1 : 1;
        });
      // Assert the service always asks for the deterministic id tie-break.
      expect(orderBy).toEqual([
        { isDefault: 'desc' },
        { updatedAt: 'desc' },
        { id: 'asc' },
      ]);
      return Promise.resolve(matched[0] ?? null);
    },
  );
  const prisma = {
    withTenant: (_id: string, cb: (tx: unknown) => unknown) =>
      cb({ template: { findFirst } }),
  };
  const branchService = {} as never;
  return new TemplateService(prisma as never, branchService);
}

function row(
  p: Partial<Row> & Pick<Row, 'id' | 'preference' | 'feature'>,
): Row {
  return {
    tenantId: TENANT,
    branchId: null,
    isActive: true,
    isDefault: false,
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
    displayTitle: p.id,
    ...p,
  };
}

describe('TemplateService selection', () => {
  describe('resolveForDelivery', () => {
    it('selects by feature (feature A → A, feature B → B) for the same channel', async () => {
      const svc = makeService([
        row({
          id: 'A',
          feature: 'feature_a',
          preference: MessagingChannel.EMAIL,
        }),
        row({
          id: 'B',
          feature: 'feature_b',
          preference: MessagingChannel.EMAIL,
        }),
      ]);
      const a = await svc.resolveForDelivery(
        TENANT,
        null,
        MessagingChannel.EMAIL,
        'feature_a',
      );
      const b = await svc.resolveForDelivery(
        TENANT,
        null,
        MessagingChannel.EMAIL,
        'feature_b',
      );
      expect(a?.id).toBe('A');
      expect(b?.id).toBe('B');
    });

    it('selects by channel (EMAIL/SMS/WHATSAPP/IAM each get their own row) for one feature', async () => {
      const f = 'feature_a';
      const svc = makeService([
        row({ id: 'E', feature: f, preference: MessagingChannel.EMAIL }),
        row({ id: 'S', feature: f, preference: MessagingChannel.SMS }),
        row({ id: 'W', feature: f, preference: MessagingChannel.WHATSAPP }),
        row({ id: 'I', feature: f, preference: MessagingChannel.IAM }),
      ]);
      expect(
        (await svc.resolveForDelivery(TENANT, null, MessagingChannel.EMAIL, f))
          ?.id,
      ).toBe('E');
      expect(
        (await svc.resolveForDelivery(TENANT, null, MessagingChannel.SMS, f))
          ?.id,
      ).toBe('S');
      expect(
        (
          await svc.resolveForDelivery(
            TENANT,
            null,
            MessagingChannel.WHATSAPP,
            f,
          )
        )?.id,
      ).toBe('W');
      expect(
        (await svc.resolveForDelivery(TENANT, null, MessagingChannel.IAM, f))
          ?.id,
      ).toBe('I');
    });

    it('never leaks another feature or channel when no exact match exists', async () => {
      const svc = makeService([
        row({
          id: 'E',
          feature: 'feature_a',
          preference: MessagingChannel.EMAIL,
        }),
      ]);
      expect(
        await svc.resolveForDelivery(
          TENANT,
          null,
          MessagingChannel.SMS,
          'feature_a',
        ),
      ).toBeNull();
      expect(
        await svc.resolveForDelivery(
          TENANT,
          null,
          MessagingChannel.EMAIL,
          'feature_b',
        ),
      ).toBeNull();
    });

    it('prefers branch-level over tenant-level over global (scope cascade)', async () => {
      const f = 'feature_a';
      const base = {
        feature: f,
        preference: MessagingChannel.EMAIL,
        isDefault: true,
      };
      const global = row({ id: 'G', tenantId: null, branchId: null, ...base });
      const tenant = row({
        id: 'T',
        tenantId: TENANT,
        branchId: null,
        ...base,
      });
      const branch = row({
        id: 'BR',
        tenantId: TENANT,
        branchId: BRANCH,
        ...base,
      });

      expect(
        (
          await makeService([global, tenant, branch]).resolveForDelivery(
            TENANT,
            BRANCH,
            MessagingChannel.EMAIL,
            f,
          )
        )?.id,
      ).toBe('BR');
      expect(
        (
          await makeService([global, tenant]).resolveForDelivery(
            TENANT,
            BRANCH,
            MessagingChannel.EMAIL,
            f,
          )
        )?.id,
      ).toBe('T');
      expect(
        (
          await makeService([global]).resolveForDelivery(
            TENANT,
            BRANCH,
            MessagingChannel.EMAIL,
            f,
          )
        )?.id,
      ).toBe('G');
    });

    it('prefers isDefault, then most-recent, then id (deterministic tie-break)', async () => {
      const base = {
        feature: 'feature_a',
        preference: MessagingChannel.EMAIL,
        tenantId: TENANT,
        branchId: null,
      };
      const sameTime = new Date('2026-05-05T00:00:00Z');
      const svc = makeService([
        row({
          id: 'zzz',
          ...base,
          isDefault: false,
          updatedAt: new Date('2026-09-09T00:00:00Z'),
        }),
        row({ id: 'mmm', ...base, isDefault: true, updatedAt: sameTime }),
        row({ id: 'aaa', ...base, isDefault: true, updatedAt: sameTime }),
      ]);
      // isDefault wins over the newer non-default; between the two defaults with an
      // identical updatedAt, the smaller id ('aaa') wins deterministically.
      expect(
        (
          await svc.resolveForDelivery(
            TENANT,
            null,
            MessagingChannel.EMAIL,
            'feature_a',
          )
        )?.id,
      ).toBe('aaa');
    });
  });

  describe('resolveActivatedTemplate', () => {
    it('resolves the tenant/branch template but NEVER falls back to a global', async () => {
      const f = 'feature_a';
      const base = {
        feature: f,
        preference: MessagingChannel.EMAIL,
        isDefault: true,
      };
      const global = row({ id: 'G', tenantId: null, branchId: null, ...base });
      const tenant = row({
        id: 'T',
        tenantId: TENANT,
        branchId: null,
        ...base,
      });

      // With a tenant template it resolves it.
      expect(
        (
          await makeService([global, tenant]).resolveActivatedTemplate(
            TENANT,
            BRANCH,
            MessagingChannel.EMAIL,
            f,
          )
        )?.id,
      ).toBe('T');
      // With ONLY a global, activated resolution returns null (no global fallback).
      expect(
        await makeService([global]).resolveActivatedTemplate(
          TENANT,
          BRANCH,
          MessagingChannel.EMAIL,
          f,
        ),
      ).toBeNull();
    });
  });
});

import { OrderStatus, Prisma } from '@prisma/client';
import { OrderService } from './order.service';
import { ListOrdersDto } from './dto/list-orders.dto';

/**
 * Registration → Billings must never list a draft or a quotation: either could
 * otherwise appear as a "Not Paid" bill with a Make Payment action (a quote that
 * went through "Save and Close" even carries a diagnostics section). The server
 * enforces this whenever `hideUnpaidAppointments` is sent — which only the
 * Billings list does — so it holds even if the client drops its own status filter.
 */
describe('OrderService — Billings scope hides drafts and quotations', () => {
  const findMany = jest.fn<
    Promise<unknown[]>,
    [{ where: Prisma.OrderWhereInput }]
  >();
  const deps = Array(13).fill(undefined) as unknown[];
  deps[0] = { order: { findMany } };
  const service = new OrderService(
    ...(deps as ConstructorParameters<typeof OrderService>),
  );

  const build = async (query: ListOrdersDto) => {
    const { where } = await (
      service as unknown as {
        buildOrderWhere: (
          q: ListOrdersDto,
          tenantId: string,
          branchId: string | null,
        ) => Promise<{ where: Prisma.OrderWhereInput }>;
      }
    ).buildOrderWhere(query, 'tenant-1', 'branch-1');
    return where;
  };

  const EXCLUDE = {
    status: { notIn: [OrderStatus.DRAFT, OrderStatus.QUOTE] },
  };

  beforeEach(() => {
    findMany.mockReset().mockResolvedValue([]);
  });

  it('excludes drafts and quotations when the Billings flag is sent', async () => {
    const where = await build({
      section: 'DIAGNOSTICS',
      hideUnpaidAppointments: true,
    });
    expect(where.AND).toContainEqual(EXCLUDE);
  });

  it('keeps the unpaid-appointment rule next to it', async () => {
    const where = await build({
      section: 'DIAGNOSTICS',
      hideUnpaidAppointments: true,
    });
    expect(where.AND).toHaveLength(2);
  });

  it('never hides real bills: orders, appointments and cancelled stay', async () => {
    const where = await build({
      section: 'DIAGNOSTICS',
      hideUnpaidAppointments: true,
    });
    const notIn = (
      (where.AND as Prisma.OrderWhereInput[]).find(
        (c) => (c.status as { notIn?: unknown } | undefined)?.notIn,
      )!.status as { notIn: OrderStatus[] }
    ).notIn;
    expect([...notIn].sort()).toEqual(['DRAFT', 'QUOTE']);
  });

  it('does not touch other screens (no Billings flag, no exclusion)', async () => {
    const where = await build({ section: 'DIAGNOSTICS' });
    expect(JSON.stringify(where)).not.toContain('notIn');
  });

  it('composes with the explicit status list the Billings screen sends', async () => {
    const where = await build({
      section: 'DIAGNOSTICS',
      hideUnpaidAppointments: true,
      statuses: [
        OrderStatus.APPOINTMENT,
        OrderStatus.ORDER,
        OrderStatus.CANCELLED,
      ],
    });
    expect(where.status).toEqual({
      in: [OrderStatus.APPOINTMENT, OrderStatus.ORDER, OrderStatus.CANCELLED],
    });
    expect(where.AND).toContainEqual(EXCLUDE);
  });

  it('wins over a client that asks for drafts or quotes (the backstop)', async () => {
    const where = await build({
      section: 'DIAGNOSTICS',
      hideUnpaidAppointments: true,
      statuses: [OrderStatus.DRAFT, OrderStatus.QUOTE, OrderStatus.ORDER],
    });
    expect(where.AND).toContainEqual(EXCLUDE);
  });

  it('also applies together with the Paid / Not Paid filter, so a quote is never counted as Not Paid', async () => {
    const where = await build({
      section: 'DIAGNOSTICS',
      hideUnpaidAppointments: true,
      billStatus: 'NOT_PAID',
    });
    expect(where.billStatus).toBe('NOT_PAID');
    expect(where.AND).toContainEqual(EXCLUDE);
  });

  it('stays inside the tenant, branch and section scope', async () => {
    const where = await build({
      section: 'DIAGNOSTICS',
      hideUnpaidAppointments: true,
    });
    expect(where).toMatchObject({
      tenantId: 'tenant-1',
      branchId: 'branch-1',
      diagnostics: { is: {} },
    });
  });
});

import { Prisma } from '@prisma/client';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { LabReportService } from './lab-report.service';
import { ListLabReportsDto } from './dto/list-lab-reports.dto';
import type { WorklistBranchScope } from './access/worklist-branch-scope';

const SINGLE_BRANCH: WorklistBranchScope = {
  rules: [{ branchId: 'b1', statuses: 'ALL' }],
};

/**
 * Technician → Reporting search bar. Besides patient name, order id, test / panel name and referral panel, it finds
 * a report by the SAMPLE BARCODE the row shows in its Barcode column (any live sample linked to the order line).
 * The list, the status-pill counts and the TAT analytics all build their `where` through `buildListWhere`, so the
 * rule lives there and every one of them follows it.
 */
describe('LabReportService — worklist search by sample barcode', () => {
  const deps = Array(11).fill(undefined) as unknown[];
  const service = new LabReportService(
    ...(deps as ConstructorParameters<typeof LabReportService>),
  );

  const build = (filters: Partial<ListLabReportsDto>) =>
    (
      service as unknown as {
        buildListWhere: (
          tenantId: string,
          scope: WorklistBranchScope,
          f: ListLabReportsDto,
          scopeIds: string[],
        ) => Prisma.LabReportWhereInput;
      }
    ).buildListWhere('t1', SINGLE_BRANCH, filters, []);

  const searchBranches = (search: string) =>
    build({ search }).orderItem?.OR ?? [];

  const barcodeBranch = (search: string) =>
    searchBranches(search).find((b) => b.orderSampleTests !== undefined);

  it('adds a barcode match to the search: a live sample of the order line whose barcode contains the text, any letter case', () => {
    expect(barcodeBranch('10023')).toEqual({
      orderSampleTests: {
        some: {
          deletedAt: null,
          sample: { barcode: { contains: '10023', mode: 'insensitive' } },
        },
      },
    });
  });

  it('is one more alternative: the old search fields are all still there, a hit on any one matches', () => {
    const branches = searchBranches('10023');
    expect(branches).toHaveLength(4);
    expect(branches.some((b) => b.branchLabTest !== undefined)).toBe(true);
    expect(branches.some((b) => b.branchLabPanel !== undefined)).toBe(true);
    expect(branches.some((b) => b.order !== undefined)).toBe(true);
    expect(barcodeBranch('10023')).toBeDefined();
  });

  it('uses the text as typed (the DTO caps its length), not split into words like the patient name', () => {
    const b = barcodeBranch('AB 12') as {
      orderSampleTests: { some: { sample: { barcode: { contains: string } } } };
    };
    expect(b.orderSampleTests.some.sample.barcode.contains).toBe('AB 12');
  });

  it('no search text: nothing about samples is added (the other sample filter is untouched)', () => {
    const where = build({});
    expect(where.orderItem?.OR).toBeUndefined();
    expect(where.orderItem?.orderSampleTests).toBeUndefined();
  });

  it('spaces, tabs and line breaks around the text are dropped before matching (a scanner or a typo must not match nothing)', () => {
    for (const typed of [' 10023 ', '10023\n', '\t10023\r\n', '  10023']) {
      expect(barcodeBranch(typed)).toEqual(barcodeBranch('10023'));
    }
  });

  it('a search of only spaces is no search at all: nothing is added to the query', () => {
    for (const blank of ['   ', '\t', '\r\n', ' \n ']) {
      const where = build({ search: blank });
      expect(where.orderItem?.OR).toBeUndefined();
    }
  });

  it('% _ and \\ are matched as typed, in every search field (never as LIKE wildcards)', () => {
    const branches = searchBranches('a%b_c\\d');
    const literal = 'a\\%b\\_c\\\\d';
    const b = barcodeBranch('a%b_c\\d') as {
      orderSampleTests: { some: { sample: { barcode: { contains: string } } } };
    };
    expect(b.orderSampleTests.some.sample.barcode.contains).toBe(literal);
    const json = JSON.stringify(branches);
    // every `contains` in the query carries the escaped text; the raw wildcard text appears nowhere
    expect(json).not.toContain('"contains":"a%b_c');
    expect(
      json.split(`"contains":"${literal.replace(/\\/g, '\\\\')}"`).length - 1,
    ).toBeGreaterThanOrEqual(4);
  });

  it('a name search of several words escapes each word', () => {
    const order = searchBranches('50% off').find(
      (x) => x.order !== undefined,
    ) as {
      order: { is: { OR: Array<{ patient?: { AND: unknown[] } }> } };
    };
    const patient = order.order.is.OR.find((x) => x.patient)!.patient!;
    expect(JSON.stringify(patient)).toContain('"contains":"50\\\\%"');
    expect(JSON.stringify(patient)).toContain('"contains":"off"');
  });

  it('the Sample Status filter keeps working next to the search: both conditions are kept', () => {
    const where = build({ search: '10023', sampleStatus: 'ACCEPTED' });
    expect(where.orderItem?.orderSampleTests).toEqual({
      some: { sample: { status: 'ACCEPTED' }, deletedAt: null },
    });
    expect(
      (where.orderItem?.OR as Prisma.OrderItemWhereInput[]).some(
        (b) => b.orderSampleTests !== undefined,
      ),
    ).toBe(true);
  });
});

describe('ListLabReportsDto — search length', () => {
  const check = async (search: string) =>
    validate(plainToInstance(ListLabReportsDto, { search }));

  it('accepts a search of up to 50 characters', async () => {
    expect(await check('a'.repeat(50))).toHaveLength(0);
  });

  it('refuses a longer search (the same cap as the Accession search)', async () => {
    const errors = await check('a'.repeat(51));
    expect(errors).toHaveLength(1);
    expect(errors[0]!.property).toBe('search');
  });
});

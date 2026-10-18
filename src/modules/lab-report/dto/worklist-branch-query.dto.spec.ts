import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListLabReportsDto } from './list-lab-reports.dto';
import { WorklistBranchQueryDto } from './worklist-branch-query.dto';

const UUID = '0d8af0ee-49f8-4860-aa5d-395a49391b7c';

async function errorsFor(
  cls: new () => object,
  plain: Record<string, unknown>,
) {
  return validate(plainToInstance(cls, plain));
}

describe.each([
  ['WorklistBranchQueryDto', WorklistBranchQueryDto],
  ['ListLabReportsDto', ListLabReportsDto],
] as const)('%s.branchId', (_name, Cls) => {
  it.each([[undefined], [UUID], ['all'], ['ALL'], [UUID.toUpperCase()]])(
    'accepts %s',
    async (value) => {
      expect(await errorsFor(Cls, { branchId: value })).toHaveLength(0);
    },
  );

  it.each([
    ['everything'],
    ['not-a-uuid'],
    [`${UUID}x`],
    [`all,${UUID}`],
    ["' OR 1=1 --"],
    [''],
  ])('rejects %j', async (value) => {
    const errors = await errorsFor(Cls, { branchId: value });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]?.property).toBe('branchId');
  });
});

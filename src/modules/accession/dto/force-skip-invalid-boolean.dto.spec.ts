import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import { BulkSampleNoteDto } from './bulk-sample-action.dto';
import { BulkTransferAcceptDto } from './bulk-transfer-action.dto';
import { TransferDispatchDto } from './transfer-dispatch.dto';

/**
 * Common shape of each per-DTO runner below. The three DTOs differ, so the
 * tuple type widens `dto` to the shared supertype (`object`); the cases only
 * ever read a flag off it (cast) or inspect `errors`.
 */
type FlagRunner = (
  extra: Record<string, unknown>,
) => Promise<{ dto: object; errors: ValidationError[] }>;

/**
 * `force` and `skipInvalid` are JSON body booleans. The global ValidationPipe turns the text "false" into `true` when it
 * converts types, so a client sending `"force": "false"` would have its status checks overridden (and `"skipInvalid":
 * "false"` would silently skip invalid samples instead of failing the batch). Only a real true / false is accepted. The
 * pipe's conversion is reproduced here (`enableImplicitConversion`).
 */
describe('force / skipInvalid accept only a real boolean', () => {
  const asPipe = { enableImplicitConversion: true } as const;
  const ID = '0b4e3b1e-3a53-4d8e-9d6c-2b0a6c8d1f11';

  const bulkSample = async (extra: Record<string, unknown>) => {
    const dto = plainToInstance(
      BulkSampleNoteDto,
      { ids: [ID], ...extra },
      asPipe,
    );
    return { dto, errors: await validate(dto) };
  };
  const bulkTransfer = async (extra: Record<string, unknown>) => {
    const dto = plainToInstance(
      BulkTransferAcceptDto,
      { ids: [ID], ...extra },
      asPipe,
    );
    return { dto, errors: await validate(dto) };
  };
  const dispatch = async (extra: Record<string, unknown>) => {
    const dto = plainToInstance(TransferDispatchDto, { ...extra }, asPipe);
    return { dto, errors: await validate(dto) };
  };

  // Each DTO declares its own flags: the bulk transfer DTO has `skipInvalid` only.
  const cases: Array<[string, FlagRunner, string[]]> = [
    ['bulk sample action', bulkSample, ['force', 'skipInvalid']],
    ['bulk transfer action', bulkTransfer, ['skipInvalid']],
    ['transfer dispatch', dispatch, ['force', 'skipInvalid']],
  ];

  it.each([true, false])('keeps a real %p for the flags', async (v) => {
    for (const [, run, flags] of cases) {
      for (const flag of flags) {
        const { dto, errors } = await run({ [flag]: v });
        expect(errors.some((e) => e.property === flag)).toBe(false);
        expect((dto as unknown as Record<string, unknown>)[flag]).toBe(v);
      }
    }
  });

  it('leaves omitted flags as they are', async () => {
    const { dto, errors } = await bulkSample({});
    expect(errors).toHaveLength(0);
    expect(dto.force).toBeUndefined();
    expect(dto.skipInvalid).toBeUndefined();
  });

  it.each(['false', 'true', '0', '1', 'no', 0, 1, {}, []])(
    'refuses %p for force and skipInvalid instead of turning it into true',
    async (v) => {
      for (const [name, run, flags] of cases) {
        for (const flag of flags) {
          const { errors } = await run({ [flag]: v });
          expect([name, flag, errors.some((e) => e.property === flag)]).toEqual(
            [name, flag, true],
          );
        }
      }
    },
  );
});

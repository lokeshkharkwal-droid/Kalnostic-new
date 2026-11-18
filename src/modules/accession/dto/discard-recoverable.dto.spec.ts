import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DiscardSampleDto } from './discard-sample.dto';
import { BulkSetRecoverableDto } from './bulk-discard-return-flags.dto';

/**
 * `isRecoverable` is a JSON body boolean. The global ValidationPipe turns the text "false" into `true` when it converts
 * types, so a client sending `"false"` had its sample stored as recoverable. Only a real true / false is accepted.
 * The pipe's conversion is reproduced here (`enableImplicitConversion`).
 */
describe('isRecoverable accepts only a real boolean', () => {
  const asPipe = { enableImplicitConversion: true } as const;
  const ID = '0b4e3b1e-3a53-4d8e-9d6c-2b0a6c8d1f11';

  const discard = async (isRecoverable: unknown) => {
    const dto = plainToInstance(
      DiscardSampleDto,
      { discardMethod: 'Biohazard Bag', isRecoverable },
      asPipe,
    );
    return { dto, errors: await validate(dto) };
  };
  const bulk = async (isRecoverable: unknown) => {
    const dto = plainToInstance(
      BulkSetRecoverableDto,
      { ids: [ID], isRecoverable },
      asPipe,
    );
    return { dto, errors: await validate(dto) };
  };

  it.each([true, false])('discard accepts %p and keeps it', async (v) => {
    const { dto, errors } = await discard(v);
    expect(errors).toHaveLength(0);
    expect(dto.isRecoverable).toBe(v);
  });

  it('discard still treats an omitted flag as "not recoverable" (no value)', async () => {
    const { dto, errors } = await discard(undefined);
    expect(errors).toHaveLength(0);
    expect(dto.isRecoverable).toBeUndefined();
  });

  it.each(['false', 'true', '0', '1', 'no', 0, 1, {}, []])(
    'discard refuses %p instead of turning it into true',
    async (v) => {
      expect((await discard(v)).errors).not.toHaveLength(0);
    },
  );

  it.each([true, false])('bulk set-recoverable accepts %p', async (v) => {
    const { dto, errors } = await bulk(v);
    expect(errors).toHaveLength(0);
    expect(dto.isRecoverable).toBe(v);
  });

  it.each(['false', 'true', '0', 'no', 0, null, undefined])(
    'bulk set-recoverable refuses %p',
    async (v) => {
      expect((await bulk(v)).errors).not.toHaveLength(0);
    },
  );
});

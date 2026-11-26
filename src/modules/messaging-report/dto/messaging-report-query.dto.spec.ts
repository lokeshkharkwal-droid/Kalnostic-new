import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  SmsReportQueryDto,
  WhatsappReportQueryDto,
} from './messaging-report-query.dto';
import { MessageIdParamDto } from './message-id-param.dto';

/** Query params arrive as strings; the global ValidationPipe converts implicitly. */
describe('messaging report query DTOs', () => {
  const asPipe = { enableImplicitConversion: true } as const;
  const range = { dateFrom: '2026-01-01', dateTo: '2026-11-23' };

  const whatsapp = async (q: Record<string, unknown>) => {
    const dto = plainToInstance(WhatsappReportQueryDto, q, asPipe);
    return { dto, errors: await validate(dto) };
  };
  const sms = async (q: Record<string, unknown>) => {
    const dto = plainToInstance(SmsReportQueryDto, q, asPipe);
    return { dto, errors: await validate(dto) };
  };

  it('accepts a range with a page and a case-insensitive status', async () => {
    const { dto, errors } = await whatsapp({
      ...range,
      page: '32',
      status: ' Delivered ',
    });
    expect(errors).toEqual([]);
    expect(dto.page).toBe(32);
    expect(dto.status).toBe('delivered');
  });

  it('an empty status means All', async () => {
    const { dto, errors } = await sms({ ...range, status: '' });
    expect(errors).toEqual([]);
    expect(dto.status).toBeUndefined();
  });

  it('requires both dates as real YYYY-MM-DD days', async () => {
    for (const q of [
      {},
      { dateFrom: '2026-01-01' },
      { ...range, dateFrom: '1 Jan 2026' },
      { ...range, dateTo: '2026-02-30' },
      { ...range, dateTo: '2026-11-23T10:00:00Z' },
    ]) {
      const { errors } = await whatsapp(q);
      expect(errors.length).toBeGreaterThan(0);
    }
  });

  it('rejects page < 1 or non-integer', async () => {
    for (const page of ['0', '-1', '1.5', 'abc']) {
      const { errors } = await whatsapp({ ...range, page });
      expect(errors.map((e) => e.property)).toContain('page');
    }
  });

  it('each channel only accepts its own delivery statuses', async () => {
    for (const status of ['delivered', 'read', 'sent', 'pending', 'failed']) {
      expect((await whatsapp({ ...range, status })).errors).toEqual([]);
    }
    for (const status of ['undelivered', 'not-sent']) {
      expect((await whatsapp({ ...range, status })).errors).not.toEqual([]);
    }
    for (const status of [
      'sent',
      'undelivered',
      'not-sent',
      'NOT-SENT',
      'failed',
      'pending',
    ]) {
      expect((await sms({ ...range, status })).errors).toEqual([]);
    }
    for (const status of ['delivered', 'read', 'bogus']) {
      expect((await sms({ ...range, status })).errors).not.toEqual([]);
    }
  });

  it('message id must be a positive integer', async () => {
    const ok = plainToInstance(MessageIdParamDto, { id: '51234' }, asPipe);
    expect(await validate(ok)).toEqual([]);
    expect(ok.id).toBe(51234);
    for (const id of ['0', 'x', '1.2']) {
      const bad = plainToInstance(MessageIdParamDto, { id }, asPipe);
      expect((await validate(bad)).length).toBeGreaterThan(0);
    }
  });
});

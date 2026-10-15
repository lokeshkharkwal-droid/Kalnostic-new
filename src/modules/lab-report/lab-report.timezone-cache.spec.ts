import { LabReportService } from './lab-report.service';

/**
 * The lab's time zone is read for the Audit Trail text on every save, so it is remembered for a few minutes per tenant
 * instead of reading the tenant each time.
 */
function build() {
  const tenantService = {
    getLocale: jest.fn((tenantId: string) =>
      Promise.resolve({
        timezone: tenantId === 'tA' ? 'Asia/Kolkata' : 'Europe/London',
      }),
    ),
  };
  const deps = Array(11).fill(undefined) as unknown[];
  deps[7] = tenantService;
  const service = new LabReportService(
    ...(deps as ConstructorParameters<typeof LabReportService>),
  );
  const tz = (tenantId: string) =>
    (
      service as unknown as { labTimezone: (t: string) => Promise<string> }
    ).labTimezone(tenantId);
  return { tz, tenantService };
}

describe('the lab time zone is remembered', () => {
  afterEach(() => jest.restoreAllMocks());

  it('reads the tenant once for repeated calls', async () => {
    const m = build();
    expect(await m.tz('tA')).toBe('Asia/Kolkata');
    expect(await m.tz('tA')).toBe('Asia/Kolkata');
    expect(await m.tz('tA')).toBe('Asia/Kolkata');
    expect(m.tenantService.getLocale).toHaveBeenCalledTimes(1);
  });

  it('keeps each tenant apart', async () => {
    const m = build();
    expect(await m.tz('tA')).toBe('Asia/Kolkata');
    expect(await m.tz('tB')).toBe('Europe/London');
    expect(await m.tz('tA')).toBe('Asia/Kolkata');
    expect(m.tenantService.getLocale).toHaveBeenCalledTimes(2);
  });

  it('reads it again after five minutes, so a changed time zone is picked up', async () => {
    const m = build();
    const start = 1_700_000_000_000;
    const now = jest.spyOn(Date, 'now').mockReturnValue(start);
    await m.tz('tA');
    now.mockReturnValue(start + 4 * 60 * 1000);
    await m.tz('tA');
    expect(m.tenantService.getLocale).toHaveBeenCalledTimes(1);
    now.mockReturnValue(start + 5 * 60 * 1000 + 1);
    await m.tz('tA');
    expect(m.tenantService.getLocale).toHaveBeenCalledTimes(2);
  });

  it('a failed lookup is not remembered', async () => {
    const m = build();
    m.tenantService.getLocale.mockRejectedValueOnce(new Error('db down'));
    await expect(m.tz('tA')).rejects.toThrow('db down');
    expect(await m.tz('tA')).toBe('Asia/Kolkata');
    expect(m.tenantService.getLocale).toHaveBeenCalledTimes(2);
  });
});

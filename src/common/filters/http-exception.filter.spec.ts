import { ArgumentsHost, BadRequestException } from '@nestjs/common';
import { REQUEST_BODY_LIMIT_MB } from '../constants/request-limits.constant';
import { HttpExceptionFilter } from './http-exception.filter';

describe('HttpExceptionFilter — request too large', () => {
  const run = (exception: unknown) => {
    const json = jest.fn<void, [unknown]>();
    const status = jest
      .fn<{ json: typeof json }, [number]>()
      .mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ method: 'PATCH', url: '/api/v1/lab-reports/1' }),
      }),
    } as unknown as ArgumentsHost;
    new HttpExceptionFilter().catch(exception, host);
    return {
      status: status.mock.calls[0]![0],
      body: json.mock.calls[0]![0],
    };
  };

  /** What the body parser throws: a plain error (not an HttpException). */
  const tooLarge = () =>
    Object.assign(new Error('request entity too large'), {
      type: 'entity.too.large',
      status: 413,
    });

  it('answers 413 with a clear, actionable message instead of a generic 500', () => {
    const { status, body } = run(tooLarge());

    expect(status).toBe(413);
    expect(body).toEqual({
      success: false,
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: `The data you sent is too large (the limit is ${REQUEST_BODY_LIMIT_MB} MB per request). Shorten the text, or remove pasted images, and try again.`,
      },
    });
  });

  it('recognises the error by its status alone too', () => {
    const { status } = run(Object.assign(new Error('x'), { status: 413 }));

    expect(status).toBe(413);
  });

  it('still turns an unknown error into the standard 500', () => {
    const { status, body } = run(new Error('boom'));

    expect(status).toBe(500);
    expect(body).toMatchObject({ error: { code: 'INTERNAL_ERROR' } });
  });

  it('still wraps a validation error with its messages (including the too-long note message)', () => {
    const message =
      'Useful For is too long (1,000,001 characters). The maximum is 1,000,000 characters.';
    const { status, body } = run(new BadRequestException([message]));

    expect(status).toBe(400);
    expect(body).toEqual({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: [message] },
    });
  });
});

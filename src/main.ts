import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import compression from 'compression';
import helmet from 'helmet';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters';
import { ResponseInterceptor } from './common/interceptors';

/**
 * Application entry point. Creates the Nest app and installs all the global
 * cross-cutting concerns before listening for requests.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  // ── CORS ──
  // Allow browser-based frontends to call this API.
  // CORS_ORIGIN can be a comma-separated list of allowed origins.
  // e.g. CORS_ORIGIN=http://localhost:5173,http://localhost:3001
  // Falls back to permissive '*' in development when not set.
  const rawOrigins = config.get<string>('CORS_ORIGIN', '*');
  const allowedOrigins =
    rawOrigins === '*' ? '*' : rawOrigins.split(',').map((o) => o.trim());

  app.enableCors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'x-tenant-id',
      'x-branch-id',
    ],
    credentials: true,
  });

  // ── Security & performance middleware ──
  // helmet() is applied AFTER enableCors so it doesn't interfere with
  // the preflight OPTIONS response.

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

  app.use(compression()); // gzip responses

  // ── EMI (lab-machine interface) raw body ──
  // The legacy analyzer contract sends `GET /emi/submitResult` with a JSON body
  // under `Content-Type: text/plain`, which the default JSON parser ignores
  // (wrong content-type → it skips without consuming the stream). Capture the
  // raw text ourselves for that one path so the EMI controller can JSON-decode
  // it. A hand-rolled reader (rather than `express.text`) keeps `express` out of
  // our runtime imports — it isn't a direct dependency under pnpm. The machine
  // payload also carries extra fields we must not reject, so this route
  // deliberately skips the global ValidationPipe (the controller reads req.body).
  app.use(
    '/emi/submitResult',
    (req: Request, _res: Response, next: NextFunction) => {
      // Already parsed by an upstream parser (e.g. a real application/json body).
      if (req.body !== undefined && req.body !== null && req.body !== '') {
        next();
        return;
      }
      let data = '';
      req.setEncoding('utf8');
      req.on('data', (chunk: string) => {
        data += chunk;
      });
      req.on('end', () => {
        req.body = data;
        next();
      });
      req.on('error', () => next());
    },
  );

  // All routes are served under /api/v1 (e.g. POST /api/v1/auth/login), EXCEPT
  // the EMI endpoints, which must keep their exact legacy paths (/emi/orders,
  // /emi/submitResult) so existing machines integrate with only a host change.
  app.setGlobalPrefix('api/v1', {
    exclude: ['emi/orders', 'emi/submitResult'],
  });

  // ── Global validation ──
  // whitelist            → strip properties not declared in the DTO
  // forbidNonWhitelisted → 400 if the client sends unknown properties
  // transform            → instantiate DTO classes & coerce primitive types
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // ── Global error formatting ──
  // Turns every thrown error into the standard error envelope.
  app.useGlobalFilters(new HttpExceptionFilter());

  // ── Global response envelope ──
  // Wraps every success response in { success, data, meta:{ timestamp, … } }.
  app.useGlobalInterceptors(new ResponseInterceptor());

  // Graceful shutdown hooks (lets PrismaService close its connection).
  app.enableShutdownHooks();

  const port = config.get<number>('PORT', 3000);
  await app.listen(port);
}

// `void` — we intentionally don't await the bootstrap promise at top level.
void bootstrap();

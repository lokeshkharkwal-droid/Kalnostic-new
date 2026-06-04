import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import compression from 'compression';
import helmet from 'helmet';
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

  // ── Security & performance middleware ──
  app.use(helmet()); // sensible security headers
  app.use(compression()); // gzip responses

  // All routes are served under /api/v1 (e.g. POST /api/v1/auth/login).
  app.setGlobalPrefix('api/v1');

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

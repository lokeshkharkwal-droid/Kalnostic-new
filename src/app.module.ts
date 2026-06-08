import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { configuration, envValidationSchema } from './config';
import { PrismaModule } from './prisma';
import { TenantContextInterceptor } from './common/interceptors';
import { BranchModule } from './modules/branch/branch.module';
import { ScheduleModule } from './modules/schedule/schedule.module';
import { TenantModule } from './modules/tenant/tenant.module';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { SiteAdminModule } from './modules/siteadmin/siteadmin.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';

/**
 * Root application module. Wires global infrastructure (config, events,
 * database), registers feature/infrastructure modules, and applies the global
 * business `JwtAuthGuard` (routes opt out with `@Public()`).
 */
@Module({
  imports: [
    // Loads + validates environment variables once, globally. The app refuses
    // to boot if validation fails (see src/config/env.validation.ts).
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration],
      validationSchema: envValidationSchema,
      validationOptions: {
        abortEarly: false, // report ALL bad env vars at once
      },
    }),

    // In-process domain events (users.* emitted by UsersService).
    EventEmitterModule.forRoot(),

    // Database access.
    PrismaModule,

    // Feature + infrastructure modules.
    BranchModule,
    ScheduleModule,
    TenantModule,
    UsersModule,
    AuthModule,
    SiteAdminModule,
  ],
  providers: [
    // Global business authentication. SiteAdmin routes use @Public() + their
    // own SiteAdminPermissionGuard instead.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Establishes the per-request tenant context (AsyncLocalStorage) from the
    // JWT so the Prisma RLS extension can scope queries. Runs after the guard.
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
  ],
})
export class AppModule {}

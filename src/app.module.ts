import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
// Aliased: the project already has a domain `ScheduleModule`
// (src/modules/schedule) for shift scheduling — this is the @nestjs/schedule
// background-job scheduler that powers @Cron jobs (e.g. audit-log retention).
import { ScheduleModule as NestScheduleModule } from '@nestjs/schedule';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { configuration, envValidationSchema } from './config';
import { PrismaModule } from './prisma';
import {
  AuditInterceptor,
  TenantContextInterceptor,
} from './common/interceptors';
import { AuditModule } from './modules/audit/audit.module';
import { BranchModule } from './modules/branch/branch.module';
import { CategoryModule } from './modules/category/category.module';
import { DepartmentModule } from './modules/department/department.module';
import { SubCategoryModule } from './modules/sub-category/sub-category.module';
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

    // Background-job scheduler (@Cron). Powers the daily audit-log retention
    // purge in AuditService. Aliased import — see top of file.
    NestScheduleModule.forRoot(),

    // Database access.
    PrismaModule,

    // Feature + infrastructure modules.
    AuditModule,
    BranchModule,
    CategoryModule,
    SubCategoryModule,
    DepartmentModule,
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
    // Records an audit row for routes annotated with `@Audit(...)`, after the
    // handler succeeds. Declared after TenantContextInterceptor so tenant
    // context is established first.
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}

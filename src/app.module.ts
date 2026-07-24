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
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { BranchCatalogueModule } from './modules/branch-catalogue/branch-catalogue.module';
import { CategoryModule } from './modules/category/category.module';
import { DepartmentModule } from './modules/department/department.module';
import { SubCategoryModule } from './modules/sub-category/sub-category.module';
import { MasterDataModule } from './modules/master-data/master-data.module';
import { LabTestModule } from './modules/lab-test/lab-test.module';
import { LabPanelModule } from './modules/lab-panel/lab-panel.module';
import { BranchLabTestModule } from './modules/branch-lab-test/branch-lab-test.module';
import { BranchLabPanelModule } from './modules/branch-lab-panel/branch-lab-panel.module';
import { TestGroupModule } from './modules/test-group/test-group.module';
import { EquipmentModule } from './modules/equipment/equipment.module';
import { LocationModule } from './modules/location/location.module';
import { OutsourceCenterModule } from './modules/outsource-center/outsource-center.module';
import { ReferralPanelModule } from './modules/referral-panel/referral-panel.module';
import { ReferralPanelSettingsModule } from './modules/referral-panel-settings/referral-panel-settings.module';
import { DoctorsModule } from './modules/doctors/doctors.module';
import { ReferralDoctorModule } from './modules/referral-doctor/referral-doctor.module';
import { ExternalReferralModule } from './modules/external-referral/external-referral.module';
import { InternalReferralModule } from './modules/internal-referral/internal-referral.module';
import { MachineModule } from './modules/machine/machine.module';
import { LabTestSettingsModule } from './modules/lab-test-settings/lab-test-settings.module';
import { DocumentModule } from './modules/document/document.module';
import { TemplateModule } from './modules/template/template.module';
import { PdfReportTemplateModule } from './modules/pdf-report-template/pdf-report-template.module';
import { ScheduleModule } from './modules/schedule/schedule.module';
import { TenantModule } from './modules/tenant/tenant.module';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { AuthRoleModule } from './modules/auth-role/auth-role.module';
import { SiteAdminModule } from './modules/siteadmin/siteadmin.module';
import { PaymentRulesModule } from './modules/payment-rules/payment-rules.module';
import { SupportInfoModule } from './modules/support-info/support-info.module';
import { ContactUsModule } from './modules/contact-us/contact-us.module';
import { PatientModule } from './modules/patient/patient.module';
import { PatientSettingsModule } from './modules/patient-settings/patient-settings.module';
import { OrderModule } from './modules/order/order.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { OrderFieldConfigModule } from './modules/order-field-config/order-field-config.module';
import { PaymentDetailsModule } from './modules/payment-details/payment-details.module';
import { BillingSettingsModule } from './modules/billing-settings/billing-settings.module';
import { ConsoleSettingsModule } from './modules/console-settings/console-settings.module';
import { ReportSettingsModule } from './modules/report-settings/report-settings.module';
import { AppointmentModule } from './modules/appointment/appointment.module';
import { AccessionModule } from './modules/accession/accession.module';
import { AppointmentSettingsModule } from './modules/appointment-settings/appointment-settings.module';
import { DoctorScheduleModule } from './modules/doctor-schedule/doctor-schedule.module';
import { PhlebotomistScheduleModule } from './modules/phlebotomist-schedule/phlebotomist-schedule.module';
import { PhlebotomistSettingsModule } from './modules/phlebotomist-settings/phlebotomist-settings.module';
import { LabReportModule } from './modules/lab-report/lab-report.module';
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
    DashboardModule,
    BranchCatalogueModule,
    CategoryModule,
    SubCategoryModule,
    DepartmentModule,
    MasterDataModule,
    LabTestModule,
    LabPanelModule,
    BranchLabTestModule,
    BranchLabPanelModule,
    TestGroupModule,
    EquipmentModule,
    LocationModule,
    OutsourceCenterModule,
    ReferralPanelModule,
    ReferralPanelSettingsModule,
    DoctorsModule,
    ReferralDoctorModule,
    ExternalReferralModule,
    InternalReferralModule,
    MachineModule,
    LabTestSettingsModule,
    DocumentModule,
    TemplateModule,
    PdfReportTemplateModule,
    ScheduleModule,
    TenantModule,
    UsersModule,
    AuthModule,
    AuthRoleModule,
    SiteAdminModule,
    PaymentRulesModule,
    SupportInfoModule,
    ContactUsModule,
    PatientModule,
    PatientSettingsModule,
    OrderModule,
    PricingModule,
    OrderFieldConfigModule,
    PaymentDetailsModule,
    BillingSettingsModule,
    ConsoleSettingsModule,
    ReportSettingsModule,
    AppointmentModule,
    AppointmentSettingsModule,
    AccessionModule,
    DoctorScheduleModule,
    PhlebotomistScheduleModule,
    PhlebotomistSettingsModule,
    LabReportModule,
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

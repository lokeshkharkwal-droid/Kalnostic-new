import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { SecurityModule } from '../security/security.module';
import { CommunicationModule } from '../communication/communication.module';
import { PatientAuthService } from './patient-auth.service';
import { PatientCredentialService } from './patient-credential.service';
import { PatientOnboardingService } from './patient-onboarding.service';
import { PatientAuthController } from './patient-auth.controller';
import { PatientCredentialController } from './patient-credential.controller';
import { JwtPatientStrategy } from './strategies/jwt-patient.strategy';

/**
 * Patient-portal authentication module — the third, isolated auth system
 * (alongside business `'jwt'` and SiteAdmin `'jwt-siteadmin'`). Registers the
 * `'jwt-patient'` Passport strategy + the JWT signer, reuses `PasswordService`
 * (SecurityModule) and the platform-level credential/refresh tables. The global
 * business `JwtAuthGuard` is unaffected — patient routes opt out with `@Public()`
 * and use `PatientJwtGuard` instead.
 */
@Module({
  imports: [
    PrismaModule,
    SecurityModule,
    ConfigModule,
    // Exchange-backed email pipeline used to deliver the credentials email when
    // a patient's portal login is auto-provisioned on registration.
    CommunicationModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [PatientAuthController, PatientCredentialController],
  providers: [
    PatientAuthService,
    PatientCredentialService,
    PatientOnboardingService,
    JwtPatientStrategy,
  ],
  exports: [
    PatientAuthService,
    PatientCredentialService,
    PatientOnboardingService,
  ],
})
export class PatientAuthModule {}

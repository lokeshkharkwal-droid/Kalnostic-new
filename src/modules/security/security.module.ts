import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PasswordService } from './password.service';
import { UsernameGeneratorService } from './username-generator.service';
import { EncryptionService } from './encryption.service';

/**
 * Infrastructure module providing cross-cutting credential helpers
 * (`PasswordService`, `UsernameGeneratorService`) and at-rest encryption
 * (`EncryptionService`). Imported by auth, tenant, users, and siteadmin so they
 * share one hashing/policy/encryption implementation.
 */
@Module({
  imports: [PrismaModule],
  providers: [PasswordService, UsernameGeneratorService, EncryptionService],
  exports: [PasswordService, UsernameGeneratorService, EncryptionService],
})
export class SecurityModule {}

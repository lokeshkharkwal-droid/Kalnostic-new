import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PasswordService } from './password.service';
import { UsernameGeneratorService } from './username-generator.service';

/**
 * Infrastructure module providing cross-cutting credential helpers
 * (`PasswordService`, `UsernameGeneratorService`). Imported by auth, tenant,
 * users, and siteadmin so they share one hashing/policy implementation.
 */
@Module({
  imports: [PrismaModule],
  providers: [PasswordService, UsernameGeneratorService],
  exports: [PasswordService, UsernameGeneratorService],
})
export class SecurityModule {}

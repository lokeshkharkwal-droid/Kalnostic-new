import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SecurityModule } from '../security/security.module';
import { BranchModule } from '../branch/branch.module';
import { UserManagementController } from './user-management.controller';
import { UsersService } from './users.service';

/**
 * Users feature module. Exports `UsersService` so the auth module can read a
 * person's profiles when building the JWT. Hosts the User Management v2.0
 * controller (`users/manage`).
 */
@Module({
  imports: [PrismaModule, SecurityModule, BranchModule],
  controllers: [UserManagementController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}

import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SecurityModule } from '../security/security.module';
import { BranchModule } from '../branch/branch.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * Users feature module. Exports `UsersService` so the auth module can read a
 * person's profiles when building the JWT.
 */
@Module({
  imports: [PrismaModule, SecurityModule, BranchModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}

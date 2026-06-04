import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BranchController } from './branch.controller';
import { BranchService } from './branch.service';

/**
 * Branch feature module. Exports `BranchService` so auth/users can resolve a
 * person's branch context (e.g. when building the JWT profiles array).
 */
@Module({
  imports: [PrismaModule],
  controllers: [BranchController],
  providers: [BranchService],
  exports: [BranchService],
})
export class BranchModule {}

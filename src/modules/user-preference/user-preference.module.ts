import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { UserPreferenceController } from './user-preference.controller';
import { UserPreferenceService } from './user-preference.service';

/** Per-user UI preferences (currently: each screen's default date filter). */
@Module({
  imports: [PrismaModule],
  controllers: [UserPreferenceController],
  providers: [UserPreferenceService],
  exports: [UserPreferenceService],
})
export class UserPreferenceModule {}

import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ConsoleSettingsController } from './console-settings.controller';
import { ConsoleSettingsService } from './console-settings.service';

/** Console settings module for Registration order workflow / TAT / sample tracking settings. */
@Module({
  imports: [PrismaModule],
  controllers: [ConsoleSettingsController],
  providers: [ConsoleSettingsService],
  exports: [ConsoleSettingsService],
})
export class ConsoleSettingsModule {}

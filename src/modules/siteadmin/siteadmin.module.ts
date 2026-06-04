import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { SecurityModule } from '../security/security.module';
import { SiteAdminService } from './siteadmin.service';
import { SiteAdminAuthController } from './siteadmin-auth.controller';
import { SiteAdminUsersController } from './siteadmin-users.controller';
import { SiteAdminJwtStrategy } from './strategies/siteadmin-jwt.strategy';

/**
 * SiteAdmin module. Registers the `'jwt-siteadmin'` Passport strategy used by
 * `SiteAdminPermissionGuard` (also consumed by the tenant controller).
 */
@Module({
  imports: [
    PrismaModule,
    SecurityModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [SiteAdminAuthController, SiteAdminUsersController],
  providers: [SiteAdminService, SiteAdminJwtStrategy],
  exports: [SiteAdminService],
})
export class SiteAdminModule {}

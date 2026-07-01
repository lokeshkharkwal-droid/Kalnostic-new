import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseInterceptors,
  UploadedFiles,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuditAction, AuditModule } from '@prisma/client';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { LabTestSettingsService } from './lab-test-settings.service';
import { CreateImageSettingDto } from './dto/create-image-setting.dto';
import { UpdateImageSettingDto } from './dto/update-image-setting.dto';
import { ListImageSettingsQueryDto } from './dto/list-image-settings-query.dto';
import { CreatePdfSettingDto } from './dto/create-pdf-setting.dto';
import { UpdatePdfSettingDto } from './dto/update-pdf-setting.dto';
import { ListPdfSettingsQueryDto } from './dto/list-pdf-settings-query.dto';
import { CreateGroupLayoutSettingDto } from './dto/create-group-layout-setting.dto';
import { UpdateGroupLayoutSettingDto } from './dto/update-group-layout-setting.dto';
import { ListGroupLayoutSettingsQueryDto } from './dto/list-group-layout-settings-query.dto';
import {
  ALLOWED_ICON_MIME_TYPES,
  CreateIconSettingDto,
} from './dto/create-icon-setting.dto';
import { UpdateIconSettingDto } from './dto/update-icon-setting.dto';
import { ListIconSettingsQueryDto } from './dto/list-icon-settings-query.dto';
import {
  InvalidIconSettingPayloadException,
  IconFileMismatchException,
} from './exceptions/lab-test-settings.exceptions';

const MAX_ICON_BYTES = 2 * 1024 * 1024;

@Controller('business-admin/lab-test-settings')
export class LabTestSettingsController {
  constructor(private readonly service: LabTestSettingsService) {}

  @Get('image-settings')
  findAll(
    @CurrentTenant() tenantId: string,
    @Query() query: ListImageSettingsQueryDto,
  ) {
    return this.service.findAll(tenantId, query.page, query.limit);
  }

  @Post('image-settings')
  @Audit({
    module: AuditModule.LAB_TEST_SETTINGS,
    action: AuditAction.CREATE,
    description: 'Created a lab image setting',
  })
  create(
    @CurrentTenant() tenantId: string,
    @Body() dto: CreateImageSettingDto,
  ) {
    return this.service.create(tenantId, dto);
  }

  @Get('image-settings/:id')
  findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.findById(id, tenantId);
  }

  @Patch('image-settings/:id')
  @Audit({
    module: AuditModule.LAB_TEST_SETTINGS,
    action: AuditAction.UPDATE,
    description: 'Updated a lab image setting',
  })
  update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateImageSettingDto,
  ) {
    return this.service.update(id, tenantId, dto);
  }

  @Delete('image-settings/:id')
  @Audit({
    module: AuditModule.LAB_TEST_SETTINGS,
    action: AuditAction.DELETE,
    description: 'Deleted a lab image setting',
  })
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.remove(id, tenantId);
  }

  // ── PDF Settings ─────────────────────────────────────────────────────────

  @Get('pdf-settings')
  findAllPdfSettings(
    @CurrentTenant() tenantId: string,
    @Query() query: ListPdfSettingsQueryDto,
  ) {
    return this.service.findAllPdfSettings(tenantId, query.page, query.limit);
  }

  @Post('pdf-settings')
  @Audit({
    module: AuditModule.LAB_TEST_SETTINGS,
    action: AuditAction.CREATE,
    description: 'Created a lab PDF setting',
  })
  createPdfSetting(
    @CurrentTenant() tenantId: string,
    @Body() dto: CreatePdfSettingDto,
  ) {
    return this.service.createPdfSetting(tenantId, dto);
  }

  @Get('pdf-settings/:id')
  findOnePdfSetting(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.service.findPdfSettingById(id, tenantId);
  }

  @Patch('pdf-settings/:id')
  @Audit({
    module: AuditModule.LAB_TEST_SETTINGS,
    action: AuditAction.UPDATE,
    description: 'Updated a lab PDF setting',
  })
  updatePdfSetting(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePdfSettingDto,
  ) {
    return this.service.updatePdfSetting(id, tenantId, dto);
  }

  @Delete('pdf-settings/:id')
  @Audit({
    module: AuditModule.LAB_TEST_SETTINGS,
    action: AuditAction.DELETE,
    description: 'Deleted a lab PDF setting',
  })
  removePdfSetting(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.removePdfSetting(id, tenantId);
  }

  // ── Group Layout Settings ───────────────────────────────────────────────

  @Get('group-layout-settings')
  findAllGroupLayoutSettings(
    @CurrentTenant() tenantId: string,
    @Query() query: ListGroupLayoutSettingsQueryDto,
  ) {
    return this.service.findAllGroupLayoutSettings(
      tenantId,
      query.page,
      query.limit,
    );
  }

  @Post('group-layout-settings')
  @Audit({
    module: AuditModule.LAB_TEST_SETTINGS,
    action: AuditAction.CREATE,
    description: 'Created a lab group layout setting',
  })
  createGroupLayoutSetting(
    @CurrentTenant() tenantId: string,
    @Body() dto: CreateGroupLayoutSettingDto,
  ) {
    return this.service.createGroupLayoutSetting(tenantId, dto);
  }

  @Get('group-layout-settings/:id')
  findOneGroupLayoutSetting(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.service.findGroupLayoutSettingById(id, tenantId);
  }

  @Patch('group-layout-settings/:id')
  @Audit({
    module: AuditModule.LAB_TEST_SETTINGS,
    action: AuditAction.UPDATE,
    description: 'Updated a lab group layout setting',
  })
  updateGroupLayoutSetting(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateGroupLayoutSettingDto,
  ) {
    return this.service.updateGroupLayoutSetting(id, tenantId, dto);
  }

  @Delete('group-layout-settings/:id')
  @Audit({
    module: AuditModule.LAB_TEST_SETTINGS,
    action: AuditAction.DELETE,
    description: 'Deleted a lab group layout setting',
  })
  removeGroupLayoutSetting(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.service.removeGroupLayoutSetting(id, tenantId);
  }

  // ── Icon Settings ────────────────────────────────────────────────────────
  // Multipart: icon files arrive as `icon1` / `icon2` form fields; all other
  // fields (name, icons config, status) arrive JSON-encoded in a `payload`
  // field, since multipart form fields are otherwise plain strings.

  @Get('icon-settings')
  findAllIconSettings(
    @CurrentTenant() tenantId: string,
    @Query() query: ListIconSettingsQueryDto,
  ) {
    return this.service.findAllIconSettings(tenantId, query.page, query.limit);
  }

  @Get('icon-settings/:id')
  findOneIconSetting(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.service.findIconSettingById(id, tenantId);
  }

  @Post('icon-settings')
  @Audit({
    module: AuditModule.LAB_TEST_SETTINGS,
    action: AuditAction.CREATE,
    description: 'Created a lab icon setting',
  })
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'icon1', maxCount: 1 },
        { name: 'icon2', maxCount: 1 },
      ],
      {
        limits: { fileSize: MAX_ICON_BYTES },
        fileFilter: (_req, file, cb) => {
          if (
            (ALLOWED_ICON_MIME_TYPES as readonly string[]).includes(
              file.mimetype,
            )
          ) {
            cb(null, true);
          } else {
            cb(
              new InvalidIconSettingPayloadException(
                'Only PNG, SVG and JPG images are allowed',
              ),
              false,
            );
          }
        },
      },
    ),
  )
  async createIconSetting(
    @CurrentTenant() tenantId: string,
    @Body('payload') payload: string,
    @UploadedFiles()
    uploaded: { icon1?: Express.Multer.File[]; icon2?: Express.Multer.File[] },
  ) {
    const dto = await this.parseIconSettingDto(payload, CreateIconSettingDto);
    const files = this.orderedIconFiles(uploaded, dto.icons.length);
    if (files.some((f) => !f)) {
      throw new IconFileMismatchException(
        `Expected ${dto.icons.length} icon file(s); every slot must have an uploaded file on create`,
        { expected: dto.icons.length },
      );
    }
    return this.service.createIconSetting(
      tenantId,
      dto,
      files as Express.Multer.File[],
    );
  }

  @Patch('icon-settings/:id')
  @Audit({
    module: AuditModule.LAB_TEST_SETTINGS,
    action: AuditAction.UPDATE,
    description: 'Updated a lab icon setting',
  })
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'icon1', maxCount: 1 },
        { name: 'icon2', maxCount: 1 },
      ],
      {
        limits: { fileSize: MAX_ICON_BYTES },
        fileFilter: (_req, file, cb) => {
          if (
            (ALLOWED_ICON_MIME_TYPES as readonly string[]).includes(
              file.mimetype,
            )
          ) {
            cb(null, true);
          } else {
            cb(
              new InvalidIconSettingPayloadException(
                'Only PNG, SVG and JPG images are allowed',
              ),
              false,
            );
          }
        },
      },
    ),
  )
  async updateIconSetting(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body('payload') payload: string,
    @UploadedFiles()
    uploaded: { icon1?: Express.Multer.File[]; icon2?: Express.Multer.File[] },
  ) {
    const dto = await this.parseIconSettingDto(payload, UpdateIconSettingDto);
    const files =
      dto.icons !== undefined
        ? this.orderedIconFiles(uploaded, dto.icons.length)
        : [];
    return this.service.updateIconSetting(id, tenantId, dto, files);
  }

  @Delete('icon-settings/:id')
  @Audit({
    module: AuditModule.LAB_TEST_SETTINGS,
    action: AuditAction.DELETE,
    description: 'Deleted a lab icon setting',
  })
  removeIconSetting(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.service.removeIconSetting(id, tenantId);
  }

  /** Parse + validate the multipart request's JSON `payload` field. */
  private async parseIconSettingDto<T extends object>(
    payload: string,
    dtoClass: new () => T,
  ): Promise<T> {
    if (!payload) {
      throw new InvalidIconSettingPayloadException(
        'Missing "payload" field with the icon setting JSON metadata',
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      throw new InvalidIconSettingPayloadException(
        '"payload" is not valid JSON',
      );
    }
    const dto = plainToInstance(dtoClass, parsed);
    const errors = await validate(dto as object, { whitelist: true });
    if (errors.length > 0) {
      throw new InvalidIconSettingPayloadException(
        errors.flatMap((e) => Object.values(e.constraints ?? {})).join('; '),
      );
    }
    return dto;
  }

  /**
   * Order uploaded icon files by slot (icon1, icon2) to match `dto.icons`,
   * truncated/padded to `count` entries (a missing slot becomes `undefined`).
   */
  private orderedIconFiles(
    uploaded: { icon1?: Express.Multer.File[]; icon2?: Express.Multer.File[] },
    count: number,
  ): Array<Express.Multer.File | undefined> {
    return [uploaded.icon1?.[0], uploaded.icon2?.[0]].slice(0, count);
  }
}

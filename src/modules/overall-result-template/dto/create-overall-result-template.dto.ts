import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { OverallResultTemplateStatus } from '@prisma/client';

/**
 * Body for creating an Overall Result template. `tenantId` is never accepted
 * from the client — it comes from the request context. `groupName` is a
 * free-text label (matches the same convention as
 * `LabTestResultParam.groupName` — string equality, no FK) that a future phase
 * will use to associate this template with matching lab-test result-parameter
 * groups. `content` is the Tiptap-authored HTML body. Validated by
 * `class-validator` only.
 */
export class CreateOverallResultTemplateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  groupName: string;

  @IsString()
  content: string;

  @IsEnum(OverallResultTemplateStatus)
  @IsOptional()
  status?: OverallResultTemplateStatus;
}

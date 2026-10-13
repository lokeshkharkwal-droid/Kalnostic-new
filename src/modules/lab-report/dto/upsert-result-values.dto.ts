import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

/** One parameter's entered value (LABORATORY.docx §4.3 Result Entry Grid row). */
export class ResultValueItemDto {
  @IsUUID()
  resultParamId: string;

  @IsOptional()
  @IsString()
  observed1?: string;

  @IsOptional()
  @IsString()
  observed2?: string;

  @IsOptional()
  @IsString()
  unit?: string;

  /**
   * Free-text methodology. Changing this re-resolves the reference range via
   * `GET /lab-reports/:id/reference-range` — the frontend is expected to call
   * that endpoint and pass the resolved `referenceRangeId`/`referenceDisplay`
   * back here, rather than this endpoint resolving it implicitly (keeps the
   * "which range matched" decision visible to the technician before saving).
   */
  @IsOptional()
  @IsString()
  methodology?: string;

  @IsOptional()
  @IsString()
  referenceRangeId?: string;

  @IsOptional()
  @IsString()
  referenceDisplay?: string;

  /**
   * For a dynamic/calculated parameter: `true` when the technician has manually
   * overridden the auto-computed value. An overridden value is stored with
   * `source = MANUAL` and is NOT recomputed on save (the override "sticks" until
   * reset). When omitted/false for a calculated parameter, the backend
   * recomputes the value from its formula and stores it with `source = CALCULATED`.
   */
  @IsOptional()
  @IsBoolean()
  isManualOverride?: boolean;

  /**
   * The technician confirmed (in the "Overwrite the analyzer's value?" dialog) that they are
   * changing an analyzer-filled value or its range. Forces the row to be saved as a human entry
   * even when the number itself is unchanged (e.g. only the range was changed).
   */
  @IsOptional()
  @IsBoolean()
  overridesAnalyzer?: boolean;

  /**
   * The row's `updatedAt` (ISO) as the screen loaded it. For a value the analyzer filled, the save
   * is refused (409) when the stored row has changed since: the analyzer re-sent a result while
   * the screen was open, and saving the old screen would silently replace the newer result.
   * Omitted by older clients, which skips the check.
   */
  @IsOptional()
  @IsDateString()
  loadedUpdatedAt?: string;
}

/** Bulk upsert body for `PATCH /lab-reports/:id/results`. Does not change status. */
export class UpsertResultValuesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ResultValueItemDto)
  values: ResultValueItemDto[];
}

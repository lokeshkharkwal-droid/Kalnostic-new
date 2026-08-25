import { IsOptional, IsString, IsUUID } from 'class-validator';

/**
 * Query params for Registration dashboard endpoints with a real User Filter
 * (Quotations/Collections/Outstandings/Canceled/Refunds — the cards with no
 * date-mode/module tab of their own). `branchId` accepts a real branch id,
 * `"all"`, or is omitted (see `RegistrationOrdersQueryDto`'s doc comment).
 * `createdBy` scopes to orders created by that one `Person` (from
 * `getRegistrationUsers`'s dropdown); omitted returns the branch's full
 * total, matching every other card's "no filter selected" default.
 */
export class RegistrationUserFilterQueryDto {
  @IsString()
  @IsOptional()
  branchId?: string;

  @IsUUID()
  @IsOptional()
  createdBy?: string;
}

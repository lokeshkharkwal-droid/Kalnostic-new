import { IsString, MaxLength } from 'class-validator';

/**
 * Manual outsource-status update (PDF §D.2/§D.3, CR-3). Because the third-party
 * lab does not use Kalnostic, staff set this free-text status manually from
 * communications received (e.g. "Picked Up", "In Progress", "Results Ready").
 */
export class OutsourceStatusDto {
  /** The manually-entered outsource status. */
  @IsString()
  @MaxLength(100)
  outsourceStatus: string;
}

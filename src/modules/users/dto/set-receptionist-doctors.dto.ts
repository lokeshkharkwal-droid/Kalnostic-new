import { IsArray, IsString } from 'class-validator';

/** Replace the set of doctors a receptionist handles at a branch. */
export class SetReceptionistDoctorsDto {
  @IsString()
  branchId: string;

  /** Doctor person ids to map (empty array clears all mappings). */
  @IsArray()
  @IsString({ each: true })
  doctorPersonIds: string[];
}

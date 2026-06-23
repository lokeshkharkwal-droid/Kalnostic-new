import { ArrayUnique, IsArray, IsUUID } from 'class-validator';

/**
 * Body for replacing the full set of sample-receiving branches mapped to a
 * Collection Center. Branch ids legitimately arrive from the client here (the
 * caller is *choosing* which branches receive this center's samples); the
 * service validates each id against the caller's tenant and the receiver rules
 * before persisting (CLAUDE.md §4.7). An empty array clears all mappings.
 */
export class SetCollectionMappingsDto {
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  receivingBranchIds: string[];
}

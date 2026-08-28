export const VECTORIZE_METADATA_INDEX = "acl_group";
export const VECTORIZE_FILTER_MAX_BYTES = 2048;

export type VectorMutation = {
  mutationId: string;
};

export class VectorizeContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VectorizeContractError";
  }
}

export function newestMutationId(ids: string[]): string {
  if (ids.length === 0) {
    throw new VectorizeContractError("no Vectorize mutation identifier was recorded");
  }
  return ids[ids.length - 1];
}

export function mutationReached(recordedNewest: string, observed: string | null | undefined): boolean {
  if (observed == null || observed === "") {
    return false;
  }
  return recordedNewest === observed;
}

export type VectorizeQuery = {
  namespace?: string;
  filter?: Record<string, unknown>;
};

export function assertVectorizeQuery(query: VectorizeQuery): void {
  if (!query.namespace) {
    throw new VectorizeContractError("Vectorize query requires a generation namespace");
  }
  if (!query.filter || query.filter[VECTORIZE_METADATA_INDEX] == null) {
    throw new VectorizeContractError("Vectorize query requires an acl_group metadata filter");
  }
}

export function assertMetadataIndexReady(ready: boolean, hasExistingVectors: boolean): void {
  if (!ready && hasExistingVectors) {
    throw new VectorizeContractError("acl_group metadata index must exist before filtered queries");
  }
}

export function assertFilterSize(serialized: string): void {
  const bytes = new TextEncoder().encode(serialized).byteLength;
  if (bytes >= VECTORIZE_FILTER_MAX_BYTES) {
    throw new VectorizeContractError("serialized Vectorize filter is 2048 bytes or more");
  }
}

export function paginateVectorIds(pages: Array<{ ids: string[]; isTruncated: boolean; nextCursor?: string }>): string[] {
  const ids: string[] = [];
  for (let i = 0; i < pages.length; i += 1) {
    const page = pages[i];
    ids.push(...page.ids);
    if (!page.isTruncated) {
      if (i !== pages.length - 1) {
        throw new VectorizeContractError("Vectorize list marked a complete inventory as truncated");
      }
      return ids;
    }
    if (!page.nextCursor) {
      throw new VectorizeContractError("Vectorize list is truncated but returned no nextCursor");
    }
  }
  throw new VectorizeContractError("Vectorize list ended while still truncated");
}

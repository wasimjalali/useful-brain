import { generationNamespace } from "../ingest/digests";
import {
  assertFilterSize,
  assertVectorizeQuery,
  VECTORIZE_METADATA_INDEX,
} from "../store/vectorize-projection";

export class RetrievalQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetrievalQueryError";
  }
}

export async function buildVectorizeQuery(input: {
  generationId: string;
  aclGroupKeys: string[];
}): Promise<{ namespace: string; filter: { acl_group: { $in: string[] } } }> {
  if (!input.generationId) {
    throw new RetrievalQueryError("Vectorize query requires a generation id");
  }
  const namespace = await generationNamespace(input.generationId);
  const filter = { [VECTORIZE_METADATA_INDEX]: { $in: input.aclGroupKeys } };
  const serialized = JSON.stringify(filter);
  assertFilterSize(serialized);
  assertVectorizeQuery({ namespace, filter });
  return { namespace, filter };
}

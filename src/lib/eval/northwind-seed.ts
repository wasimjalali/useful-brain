import type { SeedDocumentInput } from "../store/corpus-seed";
import seed from "./northwind-seed-documents.json";

export function northwindSeedDocuments(): SeedDocumentInput[] {
  return seed as SeedDocumentInput[];
}

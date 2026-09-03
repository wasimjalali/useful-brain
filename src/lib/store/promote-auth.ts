import type { SeedDocumentInput } from "./corpus-seed";
import { seedDocumentOwnerId } from "./owned-seed";

/**
 * Corpus promotion is an operator transition. A signed-in user without the
 * operator role may promote exactly one kind of generation: one whose
 * documents are public/operator-curated plus their own private uploads.
 * Ownership rides on metadata.owner_user_id; public documents carry none.
 * Anything else (another user's private doc, malformed ACL) fails closed.
 */
export function mayPromoteGeneration(
  documents: SeedDocumentInput[],
  principal: { id: string; roles: string[] },
): boolean {
  if (principal.roles.includes("operator")) {
    return true;
  }
  if (documents.length === 0) {
    return false;
  }
  return documents.every((document) => {
    const owner = seedDocumentOwnerId(document);
    if (!owner) {
      return document.accessScope === "public";
    }
    return owner === principal.id;
  });
}

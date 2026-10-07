import { WorkerForbiddenError } from "../cf/worker-errors";

export const ADMIN_ROLE = "admin";

/** Exact string match: no trimming and no case folding. */
export function isAdminPrincipal(principal: { roles: readonly string[] }): boolean {
  return principal.roles.includes(ADMIN_ROLE);
}

export function requireAdmin(principal: { roles: readonly string[] }): void {
  if (!isAdminPrincipal(principal)) {
    throw new WorkerForbiddenError();
  }
}

/** Legacy /knowledge/* gate: `operator` stays, `admin` is also accepted. */
export function hasOperatorAccess(roles: readonly string[]): boolean {
  return roles.includes("operator") || roles.includes(ADMIN_ROLE);
}

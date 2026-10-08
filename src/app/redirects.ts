/**
 * Old URLs that still resolve. Each page under these paths redirects to the
 * target, so bookmarks and the macOS shell keep working.
 */
export const LEGACY_REDIRECTS = {
  "/knowledge": "/admin/sources",
  "/knowledge/new": "/admin/sources?upload=1",
  "/evaluations": "/admin/evals",
  "/settings": "/chat?settings=1",
} as const;

export type LegacyPath = keyof typeof LEGACY_REDIRECTS;

export function legacyRedirectTarget(pathname: string): string | null {
  const trimmed = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return Object.hasOwn(LEGACY_REDIRECTS, trimmed)
    ? LEGACY_REDIRECTS[trimmed as LegacyPath]
    : null;
}

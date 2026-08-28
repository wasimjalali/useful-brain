export class HttpAllowlistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HttpAllowlistError";
  }
}

export type HttpAllowlist = {
  origins: string[];
};

export function assertAllowlistedHttpUrl(raw: string, allowlist: HttpAllowlist): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpAllowlistError("HTTP source URL is invalid");
  }
  if (url.username || url.password) {
    throw new HttpAllowlistError("HTTP source URLs must not include userinfo");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new HttpAllowlistError("HTTP source URLs must use http or https");
  }
  const origin = url.origin.toLowerCase();
  if (!allowlist.origins.map((item) => item.toLowerCase()).includes(origin)) {
    throw new HttpAllowlistError("HTTP source origin is not allowlisted");
  }
  return url;
}

export async function fetchAllowlistedSource(
  raw: string,
  allowlist: HttpAllowlist,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const url = assertAllowlistedHttpUrl(raw, allowlist);
  const response = await fetchImpl(url.toString(), { redirect: "manual" });
  if (response.status >= 300 && response.status < 400) {
    throw new HttpAllowlistError(
      "HTTP source redirects are not followed until Worker address pinning is proved",
    );
  }
  return response;
}

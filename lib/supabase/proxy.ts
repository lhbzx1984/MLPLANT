/**
 * Supabase 请求改写: 把发往 $NEXT_PUBLIC_SUPABASE_URL 的请求改为同源 /api/sb 代理。
 * 浏览器端(不可控代理环境)与 middleware 均使用此改写, 由 Next 服务端统一出网。
 */
const SB = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

export function toProxyPath(url: string, origin = ""): string {
  if (!SB || !url.startsWith(SB)) return url;
  return `${origin}/api/sb${url.slice(SB.length)}`;
}

/** 兼容 fetch(input: string | URL | Request) 的改写 fetch */
export const supabaseFetch: typeof fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const raw =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  return fetch(toProxyPath(raw), init);
}) as typeof fetch;

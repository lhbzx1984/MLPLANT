import net from "node:net";
import { Agent, fetch as undiciFetch, ProxyAgent, type Dispatcher } from "undici";

/**
 * Supabase 出网: 每次请求自动探测本机代理是否可用。
 *
 * 背景: 国内网络常无法直连 *.supabase.co。之前依赖启动时注入的 HTTP_PROXY 环境变量,
 * 打开/关闭代理软件后必须重启平台。这里改为运行期探测: 代理开着就走代理,
 * 关掉就直连, 无需重启。
 *
 * 配置: .env.local 中的 ML_PROXY(如 http://127.0.0.1:7897),
 *       未配置时回退 HTTPS_PROXY / HTTP_PROXY。
 */

const PROXY_URL =
  process.env.ML_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "";
const RECHECK_MS = 20_000;

let cachedDispatcher: Dispatcher | undefined;
let cacheAt = 0;
const directAgent = new Agent();

function portOpen(host: string, port: number, timeout = 300): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeout);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(port, host);
  });
}

async function resolveDispatcher(): Promise<Dispatcher> {
  if (!PROXY_URL) return directAgent;
  const fresh = Date.now() - cacheAt < RECHECK_MS;
  if (fresh && cachedDispatcher) return cachedDispatcher;

  let proxy: URL;
  try {
    proxy = new URL(PROXY_URL);
  } catch {
    cachedDispatcher = directAgent;
    cacheAt = Date.now();
    return directAgent;
  }

  const reachable = await portOpen(
    proxy.hostname,
    Number(proxy.port) || (proxy.protocol === "https:" ? 443 : 80)
  );
  // 显式传入 Agent(直连) 或 ProxyAgent, 避免依赖进程启动时的环境变量代理
  cachedDispatcher = reachable ? new ProxyAgent(PROXY_URL) : directAgent;
  cacheAt = Date.now();
  return cachedDispatcher;
}

/** 代理感知的 fetch: 代理可用则走代理, 否则直连(运行期自动切换, 无需重启) */
export async function supabaseFetch(
  input: string | URL | Request,
  init?: RequestInit
): Promise<Response> {
  const dispatcher = await resolveDispatcher();
  const opts = { ...(init as Record<string, unknown>), dispatcher };
  return undiciFetch(input as string, opts as never) as unknown as Promise<Response>;
}

/** 供错误提示使用: 当前实际采用的方式 */
export function outboundMode(): string {
  if (!PROXY_URL) return "直连(未配置 ML_PROXY)";
  return cachedDispatcher === directAgent || !cachedDispatcher
    ? `直连(代理 ${PROXY_URL} 未运行)`
    : `代理 ${PROXY_URL}`;
}

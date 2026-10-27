#!/usr/bin/env node
/**
 * 代理启动包装器 (Windows / 国内网络环境专用)
 *
 * 用途: supabase.co 在部分网络环境下直连失败, 本包装器在启动命令前注入
 * HTTP/HTTPS 代理环境变量 (Node 24 的 NODE_USE_ENV_PROXY 原生支持)。
 *
 * 用法:
 *   node scripts/with-proxy.mjs next dev
 *   node scripts/with-proxy.mjs next start
 *   node scripts/with-proxy.mjs scripts/create-admin.mjs admin@xx.com 123456 管理员
 *
 * 代理地址默认读取 .env.local 中的 ML_PROXY, 未配置时用 http://127.0.0.1:7897。
 * 若代理端口未开放 (如服务器上不需要代理), 自动改为直连, 不影响正常使用。
 */
import { spawn } from "child_process";
import { existsSync, readFileSync } from "fs";
import { createConnection } from "net";
import { resolve } from "path";

function readProxyFromEnvFile() {
  try {
    const env = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    const m = env.match(/^\s*ML_PROXY\s*=\s*(\S+)\s*$/m);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function portOpen(host, port, timeout = 1200) {
  return new Promise((res) => {
    const s = createConnection({ host, port });
    const done = (ok) => {
      s.destroy();
      res(ok);
    };
    s.setTimeout(timeout, () => done(false));
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
  });
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("用法: node scripts/with-proxy.mjs <命令> [参数...]");
  process.exit(1);
}

const proxyUrl = process.env.ML_PROXY || readProxyFromEnvFile() || "http://127.0.0.1:7897";
let m;
try {
  m = new URL(proxyUrl);
} catch {
  console.error(`ML_PROXY 配置无效: ${proxyUrl}`);
  process.exit(1);
}
const useProxy = await portOpen(m.hostname, Number(m.port) || 80);

const env = { ...process.env, NODE_USE_ENV_PROXY: "1" };
if (useProxy) {
  env.HTTP_PROXY = proxyUrl;
  env.HTTPS_PROXY = proxyUrl;
  env.NO_PROXY = "localhost,127.0.0.1";
  console.log(`[with-proxy] 通过代理 ${proxyUrl} 启动...`);
} else {
  console.log("[with-proxy] 代理不可用, 直连模式启动...");
}

// 首参数是本地 .js/.mjs 脚本时, 用当前 node 执行它
const [cmd, ...rest] = args;
const isScript = /\.[mc]?js$/i.test(cmd) && existsSync(resolve(cmd));
const useShell = !isScript && process.platform === "win32";
const child = useShell
  ? spawn([cmd, ...rest].join(" "), { stdio: "inherit", shell: true, env })
  : spawn(
      isScript ? process.execPath : cmd,
      isScript ? [resolve(cmd), ...rest] : rest,
      { stdio: "inherit", env }
    );
child.on("exit", (code) => process.exit(code ?? 0));

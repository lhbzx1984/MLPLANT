import { NextRequest, NextResponse } from "next/server";
import { supabaseFetch, outboundMode } from "@/lib/supabase/net";

/**
 * Supabase 同源反向代理: /api/sb/<path>?<query> -> $NEXT_PUBLIC_SUPABASE_URL/<path>?<query>
 *
 * 浏览器端所有 Supabase 请求都走这里, 由服务端统一出网, 因此学生/教师的浏览器
 * 不需要能直连 supabase.co。
 */

const HOP_HEADERS = new Set([
  "host",
  "connection",
  "content-length",
  "accept-encoding",
  "transfer-encoding",
  "keep-alive",
  "upgrade",
  "origin",
  "referer",
]);

const DROP_RESPONSE_HEADERS = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
]);

async function forward(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    return NextResponse.json({ error: "未配置 NEXT_PUBLIC_SUPABASE_URL" }, { status: 500 });
  }

  const path = req.nextUrl.pathname.replace(/^\/api\/sb/, "") || "/";
  const target = `${supabaseUrl.replace(/\/+$/, "")}${path}${req.nextUrl.search}`;

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!HOP_HEADERS.has(key.toLowerCase())) headers.set(key, value);
  });

  const body =
    req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer();

  let resp: Response;
  try {
    resp = await supabaseFetch(target, {
      method: req.method,
      headers,
      body: body as BodyInit | undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        error: "服务端无法访问 Supabase",
        detail,
        hint: `当前出网方式:${outboundMode()}。请确认本机代理软件已启动(端口与 .env.local 的 ML_PROXY 一致), 或确认网络可直连 supabase.co。`,
      },
      { status: 502 }
    );
  }

  const outHeaders = new Headers();
  resp.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (DROP_RESPONSE_HEADERS.has(k)) return;
    if (k === "set-cookie") {
      outHeaders.append(key, value);
      return;
    }
    outHeaders.set(key, value);
  });

  return new NextResponse(resp.body, { status: resp.status, headers: outHeaders });
}

export {
  forward as GET,
  forward as POST,
  forward as PUT,
  forward as PATCH,
  forward as DELETE,
  forward as HEAD,
  forward as OPTIONS,
};

"use client";
import { createBrowserClient } from "@supabase/ssr";
import { supabaseFetch } from "./proxy";

/**
 * 浏览器端 Supabase 客户端。
 * 所有请求经同源 /api/sb 反代由服务端转发(见 lib/supabase/proxy.ts),
 * 解决国内网络直连 *.supabase.co 被阻断导致浏览器端 "Failed to fetch" 的问题。
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { fetch: supabaseFetch } }
  );
}

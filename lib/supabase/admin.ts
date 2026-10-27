import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { supabaseFetch } from "./net";

/**
 * service_role 客户端: 仅在服务端 (API Route) 使用。
 * 绕过 RLS, 用于管理员建号、GPU 分配等特权操作。
 */
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: supabaseFetch as unknown as typeof fetch },
    }
  );
}

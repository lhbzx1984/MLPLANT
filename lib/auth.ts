import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/types";

export interface SessionInfo {
  user: { id: string; email?: string | null };
  profile: Profile;
}

/** 服务端组件 / 路由中获取当前登录用户及其档案 */
export async function getSessionInfo(): Promise<SessionInfo | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!profile || profile.status !== "active") return null;
  return { user, profile: profile as Profile };
}

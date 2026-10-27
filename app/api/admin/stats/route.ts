import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/** 平台概览统计 (管理员) */
export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!profile || profile.role !== "admin")
    return NextResponse.json({ error: "无权限" }, { status: 403 });

  const admin = createAdminClient();
  const [profiles, courses, nodes, activeAllocs, runningSessions, experiments] =
    await Promise.all([
      admin.from("profiles").select("role, status"),
      admin.from("courses").select("id, status"),
      admin.from("gpu_nodes").select("gpu_count, status"),
      admin
        .from("gpu_allocations")
        .select("id")
        .eq("status", "active"),
      admin
        .from("experiment_sessions")
        .select("id")
        .eq("status", "running"),
      admin.from("experiments").select("id, status"),
    ]);

  const users = profiles.data ?? [];
  return NextResponse.json({
    teachers: users.filter((u) => u.role === "teacher").length,
    students: users.filter((u) => u.role === "student").length,
    activeUsers: users.filter((u) => u.status === "active").length,
    courses: (courses.data ?? []).filter((c) => c.status === "active").length,
    experiments: (experiments.data ?? []).length,
    gpuTotal: (nodes.data ?? []).reduce(
      (s, n) => (n.status === "online" ? s + n.gpu_count : s),
      0
    ),
    gpuUsed: (activeAllocs.data ?? []).length,
    runningSessions: (runningSessions.data ?? []).length,
  });
}

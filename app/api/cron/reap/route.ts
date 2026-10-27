import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * 定时回收(建议用系统 crontab 每 5 分钟调用一次):
 *
 *   curl -X POST http://127.0.0.1:3000/api/cron/reap \
 *        -H "x-cron-secret: $CRON_SECRET"
 *
 * 做三件事, 保证"一台机器带一个班"时卡位不会泄漏:
 *   1. 超时会话: started_at + duration_minutes 已过 → 销毁容器 + 释放卡位 + 标记 stopped
 *   2. 残留卡位: 会话已结束/已不存在, 但 gpu_allocations 仍是 active → 释放
 *   3. 长期无主的卡位: session_id 为空且占用超过 30 分钟(异常中断遗留) → 释放
 */
export const maxDuration = 120;

async function authorized(req: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  const provided =
    req.headers.get("x-cron-secret") ?? req.nextUrl.searchParams.get("token");
  if (secret && provided && provided === secret) return true;

  // 也允许管理员在浏览器/控制台手工触发
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("role, status")
    .eq("id", user.id)
    .single();
  return profile?.role === "admin" && profile.status === "active";
}

async function teardownContainer(spawnerUrl: string | null, sessionId: string) {
  const url = spawnerUrl || process.env.PROVISION_WEBHOOK_URL || null;
  if (!url) return;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.SPAWNER_SECRET) headers["X-Spawner-Secret"] = process.env.SPAWNER_SECRET;
  try {
    await fetch(`${url.replace(/\/+$/, "")}/teardown`, {
      method: "POST",
      headers,
      body: JSON.stringify({ session_id: sessionId }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    // spawner 侧还有超时自毁兜底, 这里失败不阻塞
  }
}

export async function POST(req: NextRequest) {
  if (!(await authorized(req)))
    return NextResponse.json({ error: "无权限" }, { status: 403 });

  const admin = createAdminClient();
  const now = Date.now();
  const stopped: string[] = [];
  const releasedAlloc: string[] = [];
  const errors: string[] = [];

  // ---------- 1. 超时会话 ----------
  const { data: running } = await admin
    .from("experiment_sessions")
    .select("id, started_at, experiment_id, gpu_allocation_id, experiments(duration_minutes)")
    .eq("status", "running");

  for (const s of running ?? []) {
    const exp = (s as unknown as { experiments?: { duration_minutes?: number } }).experiments;
    const minutes = exp?.duration_minutes ?? 120;
    const startedAt = new Date(s.started_at as string).getTime();
    const hardLimit = startedAt + (minutes + 15) * 60 * 1000; // 多给 15 分钟收尾
    if (now < hardLimit) continue;

    // 找到该会话占用卡位的节点, 销毁容器
    const { data: allocs } = await admin
      .from("gpu_allocations")
      .select("id, node_id")
      .eq("session_id", s.id)
      .eq("status", "active");
    const nodeId = (allocs ?? [])[0]?.node_id;
    if (nodeId) {
      const { data: node } = await admin
        .from("gpu_nodes")
        .select("spawner_url")
        .eq("id", nodeId)
        .single();
      await teardownContainer(node?.spawner_url ?? null, s.id as string);
    }

    const ids = (allocs ?? []).map((a) => a.id as string);
    if (ids.length) {
      const { error } = await admin.rpc("release_gpu", { p_allocation_ids: ids });
      if (error) errors.push(`释放卡位失败 ${s.id}: ${error.message}`);
      else releasedAlloc.push(...ids);
    }

    const { error } = await admin
      .from("experiment_sessions")
      .update({ status: "stopped", stopped_at: new Date().toISOString() })
      .eq("id", s.id);
    if (error) errors.push(`停止会话失败 ${s.id}: ${error.message}`);
    else stopped.push(s.id as string);
  }

  // ---------- 2. 会话已结束但卡位仍占用 ----------
  const { data: activeAllocs } = await admin
    .from("gpu_allocations")
    .select("id, session_id, allocated_at")
    .eq("status", "active");

  const activeIds = (activeAllocs ?? []).map((a) => a.id as string);
  if (activeIds.length) {
    // 这些卡位对应的会话状态
    const sessionIds = (activeAllocs ?? [])
      .map((a) => a.session_id as string | null)
      .filter((v): v is string => !!v);
    const { data: sessions } = sessionIds.length
      ? await admin
          .from("experiment_sessions")
          .select("id, status")
          .in("id", sessionIds)
      : { data: [] as { id: string; status: string }[] };
    const stoppedSessions = new Set(
      (sessions ?? []).filter((s) => s.status !== "running").map((s) => s.id as string)
    );

    const orphanIds: string[] = [];
    for (const a of activeAllocs ?? []) {
      if (a.session_id && stoppedSessions.has(a.session_id as string)) {
        orphanIds.push(a.id as string);
      } else if (
        !a.session_id &&
        now - new Date(a.allocated_at as string).getTime() > 30 * 60 * 1000
      ) {
        orphanIds.push(a.id as string);
      }
    }
    if (orphanIds.length) {
      const { error } = await admin.rpc("release_gpu", { p_allocation_ids: orphanIds });
      if (error) errors.push(`清理残留卡位失败: ${error.message}`);
      else releasedAlloc.push(...orphanIds);
    }
  }

  return NextResponse.json({
    ok: errors.length === 0,
    checkedRunning: running?.length ?? 0,
    stoppedSessions: stopped,
    releasedAllocations: releasedAlloc.length,
    errors,
    at: new Date().toISOString(),
  });
}

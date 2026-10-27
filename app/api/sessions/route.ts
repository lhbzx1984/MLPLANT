import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * 实验会话 API: 学生开启实验时由后端分配 GPU 卡位, 并在机器上启动 JupyterLab。
 *
 * 一台机器带一个班的核心逻辑:
 *   - 每个学生占 1 个卡位(gpu_allocations.gpu_index), 8 卡 = 8 人同时在线, 第 9 人得到「已满」提示
 *   - 同一个学生在同一课程只允许 1 个运行中会话, 防止一人占多卡
 *   - 分配到的卡号会原样传给机器上的 spawner, 由它绑定 NVIDIA_VISIBLE_DEVICES
 *   - 结束时: 先让 spawner 销毁容器, 再释放卡位; spawner 侧还有超时自毁兜底
 */

export const maxDuration = 300;

const SPAWNER_TIMEOUT_MS = 170_000; // spawner 内部等待就绪上限 120s, 这里留余量

async function getAuthUser() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

function spawnerHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.SPAWNER_SECRET) headers["X-Spawner-Secret"] = process.env.SPAWNER_SECRET;
  return headers;
}

/** 组装"算力已满"的友好提示 */
async function capacityMessage(
  admin: ReturnType<typeof createAdminClient>,
  nodeId: string | null
) {
  const { data } = await admin.rpc("node_capacity");
  const rows = (data ?? []) as {
    node_id: string;
    node_name: string;
    total_cards: number;
    used_cards: number;
    free_cards: number;
  }[];
  const target = nodeId ? rows.filter((r) => r.node_id === nodeId) : rows;
  const total = target.reduce((s, r) => s + (r.total_cards ?? 0), 0);
  const used = target.reduce((s, r) => s + (r.used_cards ?? 0), 0);
  return {
    used,
    total,
    free: Math.max(0, total - used),
    nodes: target.map((r) => ({
      name: r.node_name,
      total: r.total_cards,
      used: r.used_cards,
      free: r.free_cards,
    })),
  };
}

/** 查询实验对应节点的算力容量(供学生端显示占用情况) */
export async function GET(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const admin = createAdminClient();
  const experimentId = req.nextUrl.searchParams.get("experiment_id");
  let nodeId: string | null = null;
  if (experimentId) {
    const { data: exp } = await admin
      .from("experiments")
      .select("gpu_required, gpu_node_id")
      .eq("id", experimentId)
      .single();
    if (!exp) return NextResponse.json({ error: "实验不存在" }, { status: 404 });
    nodeId = exp.gpu_node_id ?? null;
  }
  const cap = await capacityMessage(admin, nodeId);
  return NextResponse.json({ capacity: cap });
}

/** 学生开启实验会话 */
export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { experiment_id } = await req.json();
  if (!experiment_id)
    return NextResponse.json({ error: "缺少 experiment_id" }, { status: 400 });

  const admin = createAdminClient();

  const [{ data: profile }, { data: experiment }] = await Promise.all([
    admin.from("profiles").select("role, status, full_name").eq("id", user.id).single(),
    admin.from("experiments").select("*").eq("id", experiment_id).single(),
  ]);
  if (!profile || profile.status !== "active")
    return NextResponse.json({ error: "账号不可用" }, { status: 403 });
  if (!experiment) return NextResponse.json({ error: "实验不存在" }, { status: 404 });
  if (experiment.status !== "published")
    return NextResponse.json({ error: "实验未开放" }, { status: 400 });

  if (profile.role === "student") {
    const { data: enrolled } = await admin
      .from("course_enrollments")
      .select("id")
      .eq("course_id", experiment.course_id)
      .eq("student_id", user.id)
      .maybeSingle();
    if (!enrolled)
      return NextResponse.json({ error: "尚未加入该课程" }, { status: 403 });
  } else if (profile.role !== "teacher" && profile.role !== "admin") {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }

  // —— 并发限制: 同一课程只允许 1 个运行中会话, 防止一人占多卡 ——
  const { data: runningInCourse } = await admin
    .from("experiment_sessions")
    .select("id, experiment_id, started_at, experiments(title)")
    .eq("student_id", user.id)
    .eq("status", "running")
    .in(
      "experiment_id",
      (
        await admin
          .from("experiments")
          .select("id")
          .eq("course_id", experiment.course_id)
      ).data?.map((e) => e.id) ?? []
    );

  const sameExperiment = runningInCourse?.find((s) => s.experiment_id === experiment.id);
  if (sameExperiment) {
    const { data: full } = await admin
      .from("experiment_sessions")
      .select("*")
      .eq("id", sameExperiment.id)
      .single();
    return NextResponse.json({ session: full, reused: true });
  }
  if (runningInCourse && runningInCourse.length > 0) {
    const other = runningInCourse[0] as unknown as {
      experiment_id: string;
      experiments?: { title?: string } | null;
    };
    return NextResponse.json(
      {
        error: `你已有进行中的实验会话「${other.experiments?.title ?? "其他实验"}」,请先结束它再开启新实验（每人同一课程只占用 1 份算力）`,
        code: "already_running",
        occupying_session_experiment: other.experiment_id,
      },
      { status: 409 }
    );
  }

  // —— GPU 分配 ——
  let allocationIds: string[] = [];
  let gpuIndexes: number[] = [];
  let gpuLabel = "";
  let jupyterUrl: string | null = null;
  let spawnerInfo: { url?: string; container_id?: string; reused?: boolean } = {};
  let nodeName = "";
  let spawnerUrl: string | null = null;
  // 预先生成会话 ID: 同时作为数据库主键与 spawner 的容器标识, 保证结束时能精确销毁
  const sessionId = crypto.randomUUID();

  if (experiment.gpu_required) {
    const { data: alloc, error: allocErr } = await admin.rpc("allocate_gpu", {
      p_course_id: experiment.course_id,
      p_experiment_id: experiment.id,
      p_allocated_by: user.id,
      p_gpu_count: Math.max(1, experiment.gpu_count || 1),
      p_node_id: experiment.gpu_node_id ?? null,
    });
    if (allocErr)
      return NextResponse.json({ error: allocErr.message }, { status: 500 });

    if (!alloc?.ok) {
      const cap = await capacityMessage(admin, experiment.gpu_node_id ?? null);
      return NextResponse.json(
        {
          error:
            cap.total > 0
              ? `算力已满:${cap.used}/${cap.total} 卡全部占用中,请等同学结束后再试(通常几分钟内)`
              : "平台还没有可用的 GPU 机器,请联系管理员接入节点",
          code: "no_free_gpu",
          capacity: cap,
        },
        { status: 503 }
      );
    }

    allocationIds = alloc.allocation_ids ?? [];
    gpuIndexes = (alloc.gpu_indexes ?? []).map((n: number) => Number(n));
    nodeName = alloc.node_name;
    spawnerUrl = alloc.spawner_url || process.env.PROVISION_WEBHOOK_URL || null;
    gpuLabel = `${alloc.node_name} · ${alloc.gpu_type} ×${allocationIds.length} (卡 ${gpuIndexes.join(",")})`;

    // 在机器上启动 JupyterLab(绑定分配到的卡号)
    if (spawnerUrl) {
      const endpoint = `${spawnerUrl.replace(/\/+$/, "")}/provision`;
      try {
        const resp = await fetch(endpoint, {
          method: "POST",
          headers: spawnerHeaders(),
          body: JSON.stringify({
            session_id: sessionId,
            user_id: user.id,
            user_name: profile.full_name ?? "",
            experiment_id: experiment.id,
            experiment_title: experiment.title,
            node_name: nodeName,
            gpu_indexes: gpuIndexes,
            duration_minutes: experiment.duration_minutes,
          }),
          signal: AbortSignal.timeout(SPAWNER_TIMEOUT_MS),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          await admin.rpc("release_gpu", { p_allocation_ids: allocationIds });
          return NextResponse.json(
            {
              error:
                resp.status === 409
                  ? `卡位冲突(${data.detail ?? "已被占用"}),请重试——平台已释放你的分配`
                  : `实验环境启动失败:${data.detail ?? resp.status}`,
              code: "spawn_failed",
            },
            { status: 502 }
          );
        }
        jupyterUrl = data.url ?? null;
        spawnerInfo = {
          url: data.url,
          container_id: data.container_id,
          reused: data.reused,
        };
      } catch (e) {
        await admin.rpc("release_gpu", { p_allocation_ids: allocationIds });
        return NextResponse.json(
          {
            error:
              "无法连接 GPU 机器上的开通服务(spawner),请确认服务已启动、地址与秘钥正确。" +
              (e instanceof Error ? ` 详情:${e.message.slice(0, 80)}` : ""),
            code: "spawner_unreachable",
          },
          { status: 502 }
        );
      }
    } else if (alloc.endpoint) {
      // 兼容模式: 节点上常驻一个 JupyterLab, 直接拼接地址
      const base = String(alloc.endpoint).replace(/\/+$/, "");
      jupyterUrl = `${base}/lab?token=${randomBytes(12).toString("hex")}`;
    }
  }

  if (!jupyterUrl) jupyterUrl = process.env.NEXT_PUBLIC_DEFAULT_JUPYTER_URL || null;

  const { data: session, error: sessErr } = await admin
    .from("experiment_sessions")
    .insert({
      id: sessionId,
      experiment_id: experiment.id,
      student_id: user.id,
      gpu_allocation_id: allocationIds[0] ?? null,
      gpu_indexes: gpuIndexes,
      jupyter_url: jupyterUrl,
      gpu_label: gpuLabel,
      status: "running",
    })
    .select()
    .single();

  if (sessErr) {
    if (allocationIds.length)
      await admin.rpc("release_gpu", { p_allocation_ids: allocationIds });
    return NextResponse.json({ error: sessErr.message }, { status: 500 });
  }

  if (allocationIds.length && session) {
    await admin
      .from("gpu_allocations")
      .update({ session_id: session.id })
      .in("id", allocationIds);
  }

  return NextResponse.json({
    session,
    gpu_label: gpuLabel,
    gpu_indexes: gpuIndexes,
    node_name: nodeName,
    duration_minutes: experiment.duration_minutes,
    spawner: spawnerInfo,
  });
}

/** 结束会话: 学生本人 / 课程教师 / 管理员 */
export async function PATCH(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { session_id } = await req.json();
  if (!session_id)
    return NextResponse.json({ error: "缺少 session_id" }, { status: 400 });

  const admin = createAdminClient();
  const { data: session } = await admin
    .from("experiment_sessions")
    .select("*")
    .eq("id", session_id)
    .single();
  if (!session) return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  if (session.status === "stopped") return NextResponse.json({ ok: true });

  let allowed = session.student_id === user.id;
  if (!allowed) {
    const { data: profile } = await admin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (profile?.role === "admin") allowed = true;
    else if (profile?.role === "teacher") {
      const { data: e } = await admin
        .from("experiments")
        .select("teacher_id")
        .eq("id", session.experiment_id)
        .single();
      allowed = e?.teacher_id === user.id;
    }
  }
  if (!allowed) return NextResponse.json({ error: "无权限" }, { status: 403 });

  // 1) 先销毁机器上的容器(释放显存)
  const { data: allocs } = await admin
    .from("gpu_allocations")
    .select("id, node_id")
    .eq("session_id", session_id)
    .eq("status", "active");
  const nodeId = (allocs ?? [])[0]?.node_id;
  if (nodeId) {
    const { data: node } = await admin
      .from("gpu_nodes")
      .select("spawner_url")
      .eq("id", nodeId)
      .single();
    const spawnerUrl = node?.spawner_url || process.env.PROVISION_WEBHOOK_URL || null;
    if (spawnerUrl) {
      try {
        await fetch(`${spawnerUrl.replace(/\/+$/, "")}/teardown`, {
          method: "POST",
          headers: spawnerHeaders(),
          body: JSON.stringify({ session_id }),
          signal: AbortSignal.timeout(20000),
        });
      } catch {
        // 容器销毁失败不阻塞卡位释放, spawner 侧还有超时自毁兜底
      }
    }
  }

  // 2) 再释放卡位
  const allocIds = (allocs ?? []).map((a) => a.id as string);
  if (session.gpu_allocation_id && !allocIds.includes(session.gpu_allocation_id)) {
    allocIds.push(session.gpu_allocation_id);
  }
  if (allocIds.length) {
    await admin.rpc("release_gpu", { p_allocation_ids: allocIds });
  }

  const { data: updated, error } = await admin
    .from("experiment_sessions")
    .update({ status: "stopped", stopped_at: new Date().toISOString() })
    .eq("id", session_id)
    .select()
    .single();
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ session: updated });
}

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { executeCode, normalizeOutput, isJupyterConfigured } from "@/lib/jupyter";

/**
 * 在 Jupyter 内核中真实运行学生代码, 并与教师配置的「预期输出」比对。
 * POST { experiment_id, code }
 *
 * 返回:
 *   { executed: true,  output, match, expected }  真实运行完成
 *   { executed: false, reason }                   未配置 / 运行失败
 */
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { experiment_id, code } = await req.json();
  if (!experiment_id || typeof code !== "string")
    return NextResponse.json({ error: "参数不完整" }, { status: 400 });
  if (code.length > 20000)
    return NextResponse.json({ error: "代码过长" }, { status: 400 });

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("role, status")
    .eq("id", user.id)
    .single();
  if (!profile || profile.status !== "active")
    return NextResponse.json({ error: "账号不可用" }, { status: 403 });

  const { data: exp } = await admin
    .from("experiments")
    .select("*")
    .eq("id", experiment_id)
    .single();
  if (!exp) return NextResponse.json({ error: "实验不存在" }, { status: 404 });
  const experiment = exp as {
    id: string;
    course_id: string;
    teacher_id: string;
    status: string;
    expected_output: string | null;
  };

  // 权限: 学生(已选课+实验发布) / 课程教师 / 管理员
  if (profile.role === "student") {
    if (experiment.status !== "published")
      return NextResponse.json({ error: "实验未开放" }, { status: 400 });
    const { data: enrolled } = await admin
      .from("course_enrollments")
      .select("id")
      .eq("course_id", experiment.course_id)
      .eq("student_id", user.id)
      .maybeSingle();
    if (!enrolled)
      return NextResponse.json({ error: "尚未加入该课程" }, { status: 403 });
  } else if (profile.role === "teacher") {
    if (experiment.teacher_id !== user.id)
      return NextResponse.json({ error: "无权限" }, { status: 403 });
  } else if (profile.role !== "admin") {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }

  const expected = (experiment.expected_output ?? "").trim();
  if (!expected) {
    return NextResponse.json({
      executed: false,
      reason: "教师未配置预期输出,请改用代码一致性校验",
    });
  }
  if (!isJupyterConfigured()) {
    return NextResponse.json({
      executed: false,
      reason: await Promise.resolve(
        "平台未配置 Jupyter 执行环境(需在服务器设置 JUPYTER_EXECUTE_URL 与 JUPYTER_EXECUTE_TOKEN)"
      ),
    });
  }

  // 真实执行
  const result = await executeCode(code);
  if (!result.executed) {
    return NextResponse.json({ executed: false, reason: result.reason ?? "执行失败" });
  }

  const match =
    normalizeOutput(result.output) === normalizeOutput(expected);

  // 记录运行结果(最新一次)
  await admin.from("code_submissions").insert({
    experiment_id: experiment.id,
    student_id: user.id,
    code,
    score: match ? 100 : 0,
    line_total: 0,
    line_correct: 0,
    line_results: [],
    executed: true,
    output: result.output.slice(0, 20000),
    output_match: match,
  });

  return NextResponse.json({
    executed: true,
    output: result.output,
    match,
    expected,
  });
}

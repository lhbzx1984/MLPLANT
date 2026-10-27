import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/** 校验当前调用者是管理员 */
async function requireAdmin() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, status")
    .eq("id", user.id)
    .single();
  if (!profile || profile.role !== "admin" || profile.status !== "active")
    return null;
  return user;
}

/** 账号列表 */
export async function GET() {
  if (!(await requireAdmin()))
    return NextResponse.json({ error: "无权限" }, { status: 403 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: false });
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ users: data });
}

/** 创建教师/学生账号 */
export async function POST(req: NextRequest) {
  if (!(await requireAdmin()))
    return NextResponse.json({ error: "无权限" }, { status: 403 });

  const body = await req.json();
  const { email, password, full_name, role, student_no } = body as {
    email: string;
    password: string;
    full_name: string;
    role: "teacher" | "student" | "admin";
    student_no?: string;
  };

  if (!email || !password || !full_name || !role)
    return NextResponse.json({ error: "参数不完整" }, { status: 400 });
  if (password.length < 6)
    return NextResponse.json({ error: "密码至少 6 位" }, { status: 400 });

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email: email.trim(),
    password,
    email_confirm: true,
    user_metadata: { full_name, role, student_no: student_no ?? "" },
  });
  if (error) {
    const msg = error.message.includes("already")
      ? "该邮箱已被注册"
      : error.message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  return NextResponse.json({ user: data.user });
}

/** 启用/禁用账号、重置密码 */
export async function PATCH(req: NextRequest) {
  if (!(await requireAdmin()))
    return NextResponse.json({ error: "无权限" }, { status: 403 });

  const body = await req.json();
  const { id, action, status, password } = body as {
    id: string;
    action: "set_status" | "reset_password";
    status?: "active" | "disabled";
    password?: string;
  };
  if (!id || !action)
    return NextResponse.json({ error: "参数不完整" }, { status: 400 });

  const admin = createAdminClient();

  if (action === "set_status" && status) {
    const { error } = await admin
      .from("profiles")
      .update({ status })
      .eq("id", id);
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    // 禁用时同时封禁登录
    if (status === "disabled") {
      await admin.auth.admin.updateUserById(id, { ban_duration: "876000h" });
    } else {
      await admin.auth.admin.updateUserById(id, { ban_duration: "none" });
    }
    return NextResponse.json({ ok: true });
  }

  if (action === "reset_password") {
    if (!password || password.length < 6)
      return NextResponse.json({ error: "新密码至少 6 位" }, { status: 400 });
    const { error } = await admin.auth.admin.updateUserById(id, { password });
    if (error)
      return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "未知操作" }, { status: 400 });
}

/** 删除账号 */
export async function DELETE(req: NextRequest) {
  if (!(await requireAdmin()))
    return NextResponse.json({ error: "无权限" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "缺少 id" }, { status: 400 });

  const caller = await requireAdmin();
  if (caller?.id === id)
    return NextResponse.json({ error: "不能删除自己" }, { status: 400 });

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(id);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

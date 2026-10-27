import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionInfo } from "@/lib/auth";
import type { Experiment, ExperimentStep } from "@/types";
import path from "path";

export const runtime = "nodejs";

/**
 * 实验指导书 PDF 下载/预览
 * 内容: 实验名称 + 实验目标 + 实验步骤(不含实验代码与提示)
 * 权限: 管理员 / 实验归属教师 / 已加入课程的学生(实验须已发布)
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  // 1) 身份: 优先 Cookie 会话, 兼容 Authorization: Bearer <jwt>
  let user: { id: string; role: string } | null = null;
  const session = await getSessionInfo();
  if (session) {
    user = { id: session.user.id!, role: session.profile.role };
  } else {
    const auth = req.headers.get("authorization");
    if (auth?.startsWith("Bearer ")) {
      const admin = createAdminClient();
      const { data } = await admin.auth.getUser(auth.slice(7));
      if (data.user) {
        const { data: profile } = await admin
          .from("profiles")
          .select("role")
          .eq("id", data.user.id)
          .single();
        if (profile) user = { id: data.user.id, role: profile.role };
      }
    }
  }
  if (!user) return new NextResponse("未登录", { status: 401 });

  // 2) 实验与授权
  const admin = createAdminClient();
  const { data: exp } = await admin
    .from("experiments")
    .select("*")
    .eq("id", params.id)
    .single();
  if (!exp) return new NextResponse("实验不存在", { status: 404 });
  const experiment = exp as Experiment;

  let allowed = false;
  if (user.role === "admin") allowed = true;
  else if (user.role === "teacher") allowed = experiment.teacher_id === user.id;
  else if (user.role === "student" && experiment.status === "published") {
    const { data: enrolled } = await admin
      .from("course_enrollments")
      .select("id")
      .eq("course_id", experiment.course_id)
      .eq("student_id", user.id)
      .maybeSingle();
    allowed = !!enrolled;
  }
  if (!allowed) return new NextResponse("无权访问该实验指导书", { status: 403 });

  // 3) 步骤
  const { data: steps } = await admin
    .from("experiment_steps")
    .select("*")
    .eq("experiment_id", experiment.id)
    .order("step_order");
  const stepList = (steps as ExperimentStep[]) ?? [];

  // 4) 生成 PDF
  const PDFDocument = (await import("pdfkit")).default;
  const fontPath = path.join(process.cwd(), "assets", "fonts", "simhei.ttf");

  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 56, bottom: 56, left: 60, right: 60 },
    info: { Title: `实验指导书 - ${experiment.title}` },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const finished = new Promise<Buffer>((resolve) =>
    doc.on("end", () => resolve(Buffer.concat(chunks)))
  );

  doc.font(fontPath);

  doc.fontSize(24).text("实验指导书", { align: "center" });
  doc.moveDown(0.5);
  doc
    .fontSize(10)
    .fillColor("#6b7280")
    .text("ML 智学平台", { align: "center" })
    .fillColor("#111827");
  doc.moveDown();

  doc.fontSize(16).text("一、实验名称", { underline: false });
  doc.fontSize(12).text(experiment.title, { lineGap: 4 });
  doc.moveDown();

  doc.fontSize(16).text("二、实验目标");
  doc.fontSize(12);
  if (experiment.objectives?.trim()) {
    experiment.objectives
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .forEach((line) => doc.text(line.trim(), { lineGap: 4 }));
  } else if (experiment.description?.trim()) {
    doc.text(experiment.description, { lineGap: 4 });
  } else {
    doc.fillColor("#9ca3af").text("(教师未填写)").fillColor("#111827");
  }
  doc.moveDown();

  doc.fontSize(16).text("三、实验步骤");
  doc.moveDown(0.3);
  if (stepList.length === 0) {
    doc.fontSize(12).fillColor("#9ca3af").text("(暂无步骤)").fillColor("#111827");
  } else {
    stepList.forEach((s) => {
      doc.fontSize(13).text(`步骤 ${s.step_order}:${s.title}`, { lineGap: 4 });
      doc.moveDown(0.15);
      doc.fontSize(12);
      s.content
        .split(/\r?\n/)
        .filter((l) => l.trim())
        .forEach((line) => doc.text(line, { lineGap: 3, indent: 16 }));
      doc.moveDown(0.6);
    });
  }

  doc.moveDown(1);
  doc
    .fontSize(10)
    .fillColor("#9ca3af")
    .text(
      "请按照步骤指引完成实验:打开实验环境,按指导书逐步操作,并在「代码实训」中逐行输入代码。",
      { align: "center" }
    );

  doc.end();
  const pdf = await finished;

  const download = req.nextUrl.searchParams.get("download") === "1";
  const disposition = download ? "attachment" : "inline";
  const asciiName = encodeURIComponent(`guide-${experiment.id.slice(0, 8)}.pdf`);
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(
        `实验指导书-${experiment.title}.pdf`
      )}`,
      "Cache-Control": "no-store",
    },
  });
}

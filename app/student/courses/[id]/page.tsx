"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { FlaskConical, FolderOpen, Cpu } from "lucide-react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { toProxyPath } from "@/lib/supabase/proxy";
import type { Course, Material, Experiment, StepProgress, ExperimentReport } from "@/types";

export default function StudentCoursePage() {
  const params = useParams();
  const courseId = params.id as string;
  const supabase = createClient();

  const [course, setCourse] = useState<Course | null>(null);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [exps, setExps] = useState<Experiment[]>([]);
  const [progress, setProgress] = useState<StepProgress[]>([]);
  const [reports, setReports] = useState<ExperimentReport[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const [c, m, e, p, r] = await Promise.all([
      supabase.from("courses").select("*").eq("id", courseId).maybeSingle(),
      supabase
        .from("materials")
        .select("*")
        .eq("course_id", courseId)
        .order("created_at", { ascending: false }),
      supabase
        .from("experiments")
        .select("*")
        .eq("course_id", courseId)
        .eq("status", "published")
        .order("created_at"),
      supabase.from("step_progress").select("*").eq("student_id", user!.id),
      supabase.from("experiment_reports").select("*").eq("student_id", user!.id),
    ]);
    setCourse((c.data as Course) ?? null);
    setMaterials((m.data as Material[]) ?? []);
    setExps((e.data as Experiment[]) ?? []);
    setProgress((p.data as StepProgress[]) ?? []);
    setReports((r.data as ExperimentReport[]) ?? []);
    setLoading(false);
  }, [courseId, supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function download(m: Material) {
    const { data } = await supabase.storage
      .from("materials")
      .createSignedUrl(m.file_path, 300);
    if (data?.signedUrl) window.open(toProxyPath(data.signedUrl), "_blank");
  }

  if (loading) return <p className="text-slate-400 text-sm">加载中…</p>;
  if (!course) return <p className="text-slate-500">课程不存在或未加入。</p>;

  return (
    <div>
      <Link href="/student" className="text-slate-400 hover:text-slate-600 text-sm">
        ← 我的课程
      </Link>
      <h1 className="text-xl font-bold mt-1">{course.name}</h1>
      <p className="text-sm text-slate-500 mt-0.5 mb-4">{course.description}</p>

      {/* 实验 */}
      <h2 className="font-semibold mb-3 flex items-center gap-2"><FlaskConical size={17} className="text-blue-600" /> 实验列表</h2>
      {exps.length === 0 ? (
        <div className="card p-8 text-center text-slate-400 mb-6">教师还没有发布实验</div>
      ) : (
        <div className="space-y-3 mb-8">
          {exps.map((exp) => {
            const doneCount = progress.filter(
              (p) => p.experiment_id === exp.id && p.completed
            ).length;
            const report = reports.find((r) => r.experiment_id === exp.id);
            return (
              <Link
                key={exp.id}
                href={`/student/experiments/${exp.id}`}
                className="card p-5 flex items-center justify-between hover:border-blue-300 transition-colors"
              >
                <div>
                  <div className="font-medium flex items-center gap-2">
                    {exp.title}
                    {exp.gpu_required && <span className="badge-blue"><Cpu size={12} className="inline" /> GPU</span>}
                    <span className="badge-gray">
                      {exp.type === "jupyter" ? "JupyterLab" : "在线训练"}
                    </span>
                  </div>
                  <p className="text-sm text-slate-500 mt-1">{exp.description || "暂无说明"}</p>
                  <div className="text-xs text-slate-400 mt-1.5">
                    {exp.deadline
                      ? `截止 ${new Date(exp.deadline).toLocaleDateString("zh-CN")}`
                      : "无截止时间"}
                    {report?.score != null && ` · 报告得分 ${report.score}`}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-medium">
                    {doneCount > 0 ? `已完成 ${doneCount} 步` : "未开始"}
                  </div>
                  <div className="text-xs text-blue-600 mt-1">进入实验 →</div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* 资料 */}
      <h2 className="font-semibold mb-3 flex items-center gap-2"><FolderOpen size={17} className="text-blue-600" /> 教学资料</h2>
      {materials.length === 0 ? (
        <div className="card p-8 text-center text-slate-400">教师还没有上传资料</div>
      ) : (
        <div className="card divide-y divide-slate-100">
          {materials.map((m) => (
            <div key={m.id} className="flex items-center justify-between px-5 py-3">
              <div>
                <div className="font-medium text-sm">{m.title}</div>
                <div className="text-xs text-slate-400">
                  {m.file_name} ·{" "}
                  {m.file_size ? `${(m.file_size / 1024).toFixed(1)} KB` : "-"} ·{" "}
                  {new Date(m.created_at).toLocaleString("zh-CN")}
                  {m.description ? ` · ${m.description}` : ""}
                </div>
              </div>
              <button className="text-blue-600 hover:underline text-sm" onClick={() => download(m)}>
                下载
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

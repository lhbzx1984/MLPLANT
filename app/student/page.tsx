"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { BookOpen, FlaskConical, CheckCircle2, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Course, CourseEnrollment, Experiment, StepProgress } from "@/types";

export default function StudentCoursesPage() {
  const supabase = createClient();
  const [enrollments, setEnrollments] = useState<CourseEnrollment[]>([]);
  const [exps, setExps] = useState<Experiment[]>([]);
  const [progress, setProgress] = useState<StepProgress[]>([]);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const [en, e, p] = await Promise.all([
      supabase
        .from("course_enrollments")
        .select("*, courses(*)")
        .eq("student_id", user!.id),
      supabase.from("experiments").select("id, course_id, status, title"),
      supabase.from("step_progress").select("*").eq("student_id", user!.id),
    ]);
    setEnrollments((en.data as CourseEnrollment[]) ?? []);
    setExps((e.data as Experiment[]) ?? []);
    setProgress((p.data as StepProgress[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function joinCourse(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const { error } = await supabase.rpc("join_course", { p_code: code });
    if (error) setError(error.message);
    else {
      setCode("");
      load();
    }
  }

  return (
    <div>
      <div className="tech-banner h-32 md:h-40">
        <Image src="/assets/banner-student.png" alt="我的课程" fill className="object-cover opacity-80" priority />
        <div className="absolute inset-0 bg-gradient-to-r from-[#0a1122]/90 via-[#0a1122]/50 to-transparent" />
        <div className="absolute inset-0 flex flex-col justify-center px-8">
          <h1 className="tech-title text-2xl md:text-3xl">我的课程</h1>
          <p className="text-slate-300 text-sm mt-2">凭教师提供的邀请码加入课程,按实验步骤学习</p>
        </div>
      </div>

      <form onSubmit={joinCourse} className="card p-4 mb-6 flex gap-2 items-center">
        <input
          className="input flex-1"
          placeholder="输入课程邀请码"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
        <button className="btn-primary" disabled={!code}>
          <Plus size={15} />
          加入课程
        </button>
      </form>
      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      {loading ? (
        <p className="text-slate-400 text-sm">加载中…</p>
      ) : enrollments.length === 0 ? (
        <div className="card p-10 text-center text-slate-400">
          <BookOpen className="w-10 h-10 mx-auto text-slate-300 mb-3"/>
          还没有加入任何课程,向教师索取邀请码加入吧
        </div>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {enrollments.map((en) => {
            const c = en.courses as unknown as Course;
            if (!c) return null;
            const courseExps = exps.filter((e) => e.course_id === c.id);
            // 已完成步骤数 / 课程全部步骤数 (学生可见的已发布实验的进度仅统计自己完成的)
            const done = progress.filter((p) =>
              courseExps.some((e) => e.id === p.experiment_id) && p.completed
            ).length;
            return (
              <Link
                key={en.id}
                href={`/student/courses/${c.id}`}
                className="card p-5 hover:shadow-md hover:border-blue-300 transition-all"
              >
                <div className="flex items-start justify-between">
                  <h2 className="font-semibold">{c.name}</h2>
                  <span className={c.status === "active" ? "badge-green" : "badge-gray"}>
                    {c.status === "active" ? "进行中" : "已归档"}
                  </span>
                </div>
                <p className="text-sm text-slate-500 mt-2 line-clamp-2 min-h-[2.5rem]">
                  {c.description || "暂无简介"}
                </p>
                <div className="flex gap-4 text-xs text-slate-400 mt-3">
                  <span className="inline-flex items-center gap-1"><FlaskConical size={13} /> 实验 {courseExps.length} 个</span>
                  <span className="inline-flex items-center gap-1"><CheckCircle2 size={13} /> 已完成 {done} 步</span>
                </div>
                <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-blue-600">
                  进入学习 →
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

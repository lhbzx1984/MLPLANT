"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { BookOpen, Users, FlaskConical, Cpu, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Course, Experiment, CourseEnrollment } from "@/types";

export default function TeacherCoursesPage() {
  const supabase = createClient();
  const [courses, setCourses] = useState<Course[]>([]);
  const [exps, setExps] = useState<Experiment[]>([]);
  const [enrolls, setEnrolls] = useState<CourseEnrollment[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", gpu_quota: 0 });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [c, e, en] = await Promise.all([
      supabase
        .from("courses")
        .select("*")
        .order("created_at", { ascending: false }),
      supabase.from("experiments").select("id, course_id, status"),
      supabase.from("course_enrollments").select("id, course_id"),
    ]);
    setCourses((c.data as Course[]) ?? []);
    setExps((e.data as Experiment[]) ?? []);
    setEnrolls((en.data as CourseEnrollment[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function createCourse(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = await supabase.from("courses").insert({
      name: form.name,
      description: form.description,
      gpu_quota: Number(form.gpu_quota) || 0,
      teacher_id: user!.id,
    });
    if (error) setError(error.message);
    else {
      setShowCreate(false);
      setForm({ name: "", description: "", gpu_quota: 0 });
      load();
    }
  }

  async function copyCode(code: string) {
    await navigator.clipboard.writeText(code);
    alert(`邀请码 ${code} 已复制,发给学生即可加入课程`);
  }

  return (
    <div>
      <div className="tech-banner h-32 md:h-40">
        <Image src="/assets/banner-teacher.png" alt="我的课程" fill className="object-cover opacity-80" priority />
        <div className="absolute inset-0 bg-gradient-to-r from-[#0a1122]/90 via-[#0a1122]/50 to-transparent" />
        <div className="absolute inset-0 flex flex-col justify-center px-8">
          <h1 className="tech-title text-2xl md:text-3xl">我的课程</h1>
          <p className="text-slate-300 text-sm mt-2">开设课程平台,上传资料、开设实验、跟踪学生学习情况</p>
        </div>
      </div>
      <div className="flex items-center justify-end mb-4 -mt-2">
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          <Plus size={15} />
          开设课程
        </button>
      </div>

      {loading ? (
        <p className="text-slate-400 text-sm">加载中…</p>
      ) : courses.length === 0 ? (
        <div className="card p-10 text-center text-slate-400">
          <BookOpen className="w-10 h-10 mx-auto text-slate-300 mb-3"/>
          还没有课程,点击「开设课程」创建你的第一个课程平台
        </div>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {courses.map((c) => (
            <Link
              key={c.id}
              href={`/teacher/courses/${c.id}`}
              className="card p-5 hover:shadow-md hover:border-blue-300 transition-all"
            >
              <div className="flex items-start justify-between">
                <h2 className="font-semibold text-base">{c.name}</h2>
                <span className={c.status === "active" ? "badge-green" : "badge-gray"}>
                  {c.status === "active" ? "进行中" : "已归档"}
                </span>
              </div>
              <p className="text-sm text-slate-500 mt-2 line-clamp-2 min-h-[2.5rem]">
                {c.description || "暂无简介"}
              </p>
              <div className="flex gap-4 text-xs text-slate-400 mt-3">
                <span className="inline-flex items-center gap-1"><Users size={13} /> 学生 {enrolls.filter((e) => e.course_id === c.id).length}</span>
                <span className="inline-flex items-center gap-1"><FlaskConical size={13} /> 实验 {exps.filter((e) => e.course_id === c.id).length}</span>
                <span className="inline-flex items-center gap-1"><Cpu size={13} /> GPU 配额 {c.gpu_quota} 卡</span>
              </div>
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
                <span
                  className="font-mono text-xs bg-slate-100 rounded px-2 py-1 cursor-pointer hover:bg-slate-200 inline-flex items-center gap-1"
                  onClick={(e) => {
                    e.preventDefault();
                    copyCode(c.invite_code);
                  }}
                  title="点击复制邀请码"
                >
                  邀请码 {c.invite_code}
                </span>
                <span className="text-xs text-blue-600">进入管理 →</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <form onSubmit={createCourse} className="card p-6 w-full max-w-md space-y-3">
            <h2 className="font-bold text-lg">开设课程</h2>
            <div>
              <label className="label">课程名称 *</label>
              <input
                className="input"
                required
                placeholder="如:机器学习基础实践"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <label className="label">课程简介</label>
              <textarea
                className="input"
                rows={3}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div>
              <label className="label">GPU 配额(卡数,0 为不使用)</label>
              <input
                type="number"
                min={0}
                className="input"
                value={form.gpu_quota}
                onChange={(e) => setForm({ ...form, gpu_quota: Number(e.target.value) })}
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-secondary" onClick={() => setShowCreate(false)}>
                取消
              </button>
              <button type="submit" className="btn-primary">创建</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

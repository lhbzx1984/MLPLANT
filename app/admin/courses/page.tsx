"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Course, CourseEnrollment } from "@/types";

export default function AdminCoursesPage() {
  const supabase = createClient();
  const [courses, setCourses] = useState<Course[]>([]);
  const [enrollments, setEnrollments] = useState<CourseEnrollment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [c, e] = await Promise.all([
        supabase
          .from("courses")
          .select("*, profiles(full_name, email)")
          .order("created_at", { ascending: false }),
        supabase.from("course_enrollments").select("id, course_id, student_id"),
      ]);
      setCourses((c.data as Course[]) ?? []);
      setEnrollments((e.data as CourseEnrollment[]) ?? []);
      setLoading(false);
    })();
  }, [supabase]);

  return (
    <div>
      <h1 className="text-xl font-bold mb-1">课程总览</h1>
      <p className="text-sm text-slate-500 mb-4">全平台教师开设的课程</p>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="text-left px-4 py-3">课程名称</th>
              <th className="text-left px-4 py-3">授课教师</th>
              <th className="text-left px-4 py-3">学生数</th>
              <th className="text-left px-4 py-3">邀请码</th>
              <th className="text-left px-4 py-3">GPU 配额</th>
              <th className="text-left px-4 py-3">状态</th>
              <th className="text-left px-4 py-3">创建时间</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">加载中…</td>
              </tr>
            ) : courses.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                  教师还未开设课程
                </td>
              </tr>
            ) : (
              courses.map((c) => (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="px-4 py-3">
                    <div className="font-medium">{c.name}</div>
                    {c.description && (
                      <div className="text-xs text-slate-400 truncate max-w-xs">{c.description}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">{c.profiles?.full_name ?? "-"}</td>
                  <td className="px-4 py-3">
                    {enrollments.filter((e) => e.course_id === c.id).length}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{c.invite_code}</td>
                  <td className="px-4 py-3">{c.gpu_quota} 卡</td>
                  <td className="px-4 py-3">
                    <span className={c.status === "active" ? "badge-green" : "badge-gray"}>
                      {c.status === "active" ? "进行中" : "已归档"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs">
                    {new Date(c.created_at).toLocaleDateString("zh-CN")}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

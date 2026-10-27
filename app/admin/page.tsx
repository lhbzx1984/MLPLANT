"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import {
  GraduationCap,
  Users,
  BookOpen,
  FlaskConical,
  Cpu,
  Zap,
} from "lucide-react";

const CARDS = [
  { key: "teachers", label: "教师账号", icon: GraduationCap, color: "text-blue-600 bg-blue-50 border-blue-100" },
  { key: "students", label: "学生账号", icon: Users, color: "text-indigo-600 bg-indigo-50 border-indigo-100" },
  { key: "courses", label: "进行中课程", icon: BookOpen, color: "text-emerald-600 bg-emerald-50 border-emerald-100" },
  { key: "experiments", label: "实验总数", icon: FlaskConical, color: "text-amber-600 bg-amber-50 border-amber-100" },
  { key: "gpu", label: "GPU 已分配 / 总卡数", icon: Cpu, color: "text-purple-600 bg-purple-50 border-purple-100" },
  { key: "runningSessions", label: "运行中的实验会话", icon: Zap, color: "text-rose-600 bg-rose-50 border-rose-100" },
] as const;

export default function AdminHome() {
  const [stats, setStats] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/stats")
      .then((r) => r.json())
      .then((d) => setStats(d))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      {/* 横幅(Agnes 生成) */}
      <div className="tech-banner h-40 md:h-48">
        <Image
          src="/assets/banner-admin.png"
          alt="平台概览"
          fill
          className="object-cover opacity-80"
          priority
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#0a1122]/90 via-[#0a1122]/50 to-transparent" />
        <div className="absolute inset-0 flex flex-col justify-center px-8">
          <h1 className="tech-title text-2xl md:text-3xl">平台概览</h1>
          <p className="text-slate-300 text-sm mt-2 max-w-md">
            管理平台账号、云端 GPU 资源与课程运行情况
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {CARDS.map((c) => {
          const Icon = c.icon;
          return (
            <div key={c.key} className="card p-5 flex items-center gap-4">
              <div
                className={`w-12 h-12 rounded-xl border flex items-center justify-center ${c.color}`}
              >
                <Icon size={22} />
              </div>
              <div>
                {c.key === "gpu" ? (
                  <div className="text-2xl font-bold">
                    {loading ? "-" : `${stats.gpuUsed ?? 0} / ${stats.gpuTotal ?? 0}`}
                  </div>
                ) : (
                  <div className="text-2xl font-bold">
                    {loading ? "-" : (stats[c.key] ?? 0)}
                  </div>
                )}
                <div className="text-xs text-slate-500 mt-0.5">{c.label}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="card p-6 mt-6">
        <h2 className="font-semibold mb-3">平台工作流</h2>
        <ol className="list-decimal pl-6 space-y-2 text-sm text-slate-600">
          <li>
            <b>账号管理</b>:为教师和学生开通账号并分配角色权限(可禁用/重置密码)。
          </li>
          <li>
            <b>GPU 资源池</b>:接入云端 GPU 服务器(注册节点名称、地址、卡数),平台自动将空闲卡分配给实验会话。
          </li>
          <li>
            <b>教师侧</b>:教师创建课程,上传教学资料,开设带步骤的实验并配置 GPU 需求;实时查看学生学习与实验进度。
          </li>
          <li>
            <b>学生侧</b>:学生凭邀请码加入课程,按实验步骤学习,一键进入 JupyterLab 完成实验,平台自动分配 GPU。
          </li>
        </ol>
      </div>
    </div>
  );
}

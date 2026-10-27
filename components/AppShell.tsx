"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Cpu,
  BookOpen,
  FlaskConical,
  Settings,
  LogOut,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Role } from "@/types";

export interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
}

const NAVS: Record<Role, NavItem[]> = {
  admin: [
    { href: "/admin", label: "平台概览", icon: LayoutDashboard },
    { href: "/admin/users", label: "账号管理", icon: Users },
    { href: "/admin/gpu", label: "GPU 资源池", icon: Cpu },
    { href: "/admin/courses", label: "课程总览", icon: BookOpen },
  ],
  teacher: [
    { href: "/teacher", label: "我的课程", icon: BookOpen },
    { href: "/teacher/gpu", label: "GPU 算力", icon: Cpu },
    { href: "/train", label: "在线训练", icon: FlaskConical },
  ],
  student: [
    { href: "/student", label: "我的课程", icon: BookOpen },
    { href: "/train", label: "在线训练", icon: FlaskConical },
  ],
};

const ROLE_NAME: Record<Role, string> = {
  admin: "平台管理员",
  teacher: "教师",
  student: "学生",
};

export default function AppShell({
  profile,
  children,
}: {
  profile: { full_name: string; email: string | null; role: Role };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const nav = NAVS[profile.role];

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="min-h-screen flex">
      {/* 侧边栏 */}
      <aside className="w-60 shrink-0 flex flex-col border-r border-white/5 bg-gradient-to-b from-[#0a1122] via-[#0b1530] to-[#081020]">
        <div className="px-5 py-5 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl overflow-hidden ring-1 ring-cyan-400/30 shadow-[0_0_18px_rgba(6,182,212,0.35)]">
              <Image
                src="/assets/logo.png"
                alt="ML 智学平台"
                width={40}
                height={40}
                className="w-full h-full object-cover"
              />
            </div>
            <div>
              <div className="text-base font-bold text-white tracking-wide">
                ML 智学平台
              </div>
              <div className="text-[11px] text-cyan-300/70 mt-0.5 tracking-wider">
                机器学习教学实验平台
              </div>
            </div>
          </div>
        </div>
        <nav className="flex-1 py-4 px-3 space-y-1">
          {nav.map((item) => {
            const active =
              pathname === item.href ||
              (item.href !== "/admin" &&
                item.href !== "/teacher" &&
                item.href !== "/student" &&
                pathname.startsWith(item.href)) ||
              (item.href === "/student" && pathname.startsWith("/student")) ||
              (item.href === "/teacher" && pathname.startsWith("/teacher"));
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-sm transition-all ${
                  active
                    ? "text-white bg-gradient-to-r from-blue-600/40 to-cyan-500/20 border border-cyan-400/30 shadow-[0_0_14px_rgba(6,182,212,0.18)]"
                    : "text-slate-400 hover:text-white hover:bg-white/5 border border-transparent"
                }`}
              >
                <Icon size={17} className={active ? "text-cyan-300" : ""} />
                {item.label}
                {active && (
                  <span className="ml-auto w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-[0_0_6px_rgba(6,182,212,0.9)]" />
                )}
              </Link>
            );
          })}
        </nav>
        <div className="px-4 py-4 border-t border-white/5 text-xs space-y-2">
          <Link
            href="/settings"
            className="flex items-center gap-2 text-slate-400 hover:text-cyan-300 transition-colors"
          >
            <Settings size={14} />
            个人设置
          </Link>
          <div className="text-slate-600 truncate">{profile.email}</div>
        </div>
      </aside>

      {/* 主区域 */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 bg-white/80 backdrop-blur border-b border-slate-200 flex items-center justify-between px-6">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <span className="w-1.5 h-1.5 rounded-full bg-gradient-to-r from-blue-500 to-cyan-400" />
            {ROLE_NAME[profile.role]}中心
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">{profile.full_name || "用户"}</span>
            <span className="badge bg-blue-50 text-blue-700 border border-blue-200">
              {ROLE_NAME[profile.role]}
            </span>
            <button onClick={logout} className="btn-secondary">
              <LogOut size={14} />
              退出
            </button>
          </div>
        </header>
        <main className="flex-1 p-6 overflow-x-hidden">{children}</main>
      </div>
    </div>
  );
}

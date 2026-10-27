"use client";

import Image from "next/image";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogIn, ShieldCheck, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) {
      setError(
        error.message === "Invalid login credentials"
          ? "邮箱或密码错误"
          : error.message
      );
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", (await supabase.auth.getUser()).data.user!.id)
      .single();
    router.replace(`/${data?.role ?? "student"}`);
    router.refresh();
  }

  return (
    <div className="min-h-screen relative flex items-center justify-center px-4">
      {/* Agnes 生成的全屏主视觉背景 */}
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url(/assets/login-bg.png)" }}
      />
      <div className="absolute inset-0 bg-gradient-to-r from-[#060b18]/90 via-[#060b18]/60 to-[#060b18]/30" />

      <div className="relative w-full max-w-5xl grid lg:grid-cols-2 gap-10 items-center py-10">
        {/* 品牌区 */}
        <div className="hidden lg:block">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-14 h-14 rounded-2xl overflow-hidden ring-2 ring-cyan-400/40 shadow-[0_0_30px_rgba(6,182,212,0.45)]">
              <Image
                src="/assets/logo.png"
                alt="ML 智学平台"
                width={56}
                height={56}
                className="w-full h-full object-cover"
              />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-white tracking-wide">
                ML 智学平台
              </h1>
              <div className="text-cyan-300/80 text-sm mt-1 tracking-widest">
                MACHINE LEARNING EDUCATION PLATFORM
              </div>
            </div>
          </div>
          <p className="text-slate-300 leading-relaxed mb-8 max-w-md">
            课程管理 · 实验步骤引导 · JupyterLab 实验环境 · 云端 GPU
            算力分配,一站式机器学习教学实验平台。
          </p>
          <div className="space-y-3 text-sm text-slate-300">
            {[
              "教师开设课程与实验,学生按步骤逐步学习",
              "云端 GPU 自动分配,一键进入 JupyterLab 实验环境",
              "代码逐行校验 + 内核真实运行,实验结果自动判定",
            ].map((t) => (
              <div key={t} className="flex items-center gap-2.5">
                <Sparkles size={15} className="text-cyan-400 shrink-0" />
                {t}
              </div>
            ))}
          </div>
          <div className="mt-10 w-56 rounded-2xl overflow-hidden ring-1 ring-cyan-400/20 hidden xl:block">
            <Image
              src="/assets/login-robot.png"
              alt="AI 助手"
              width={224}
              height={224}
              className="w-full h-full object-cover"
              priority
            />
          </div>
        </div>

        {/* 登录卡片(玻璃拟态) */}
        <div className="w-full max-w-md mx-auto lg:mx-0 lg:justify-self-end">
          <div className="rounded-2xl border border-white/15 bg-white/[0.07] backdrop-blur-xl p-8 shadow-[0_8px_40px_rgba(0,0,0,0.45)]">
            <div className="lg:hidden flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl overflow-hidden ring-1 ring-cyan-400/40">
                <Image
                  src="/assets/logo.png"
                  alt="ML"
                  width={40}
                  height={40}
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="text-xl font-bold text-white">ML 智学平台</div>
            </div>
            <div className="text-white font-semibold text-lg mb-1">欢迎回来</div>
            <div className="text-slate-400 text-sm mb-6">
              登录以继续你的教学与实验
            </div>

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-sm text-slate-300 mb-1.5">邮箱</label>
                <input
                  type="email"
                  className="w-full rounded-lg border border-white/15 bg-white/[0.06] px-3.5 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-cyan-400/60 focus:border-cyan-400 transition"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1.5">密码</label>
                <input
                  type="password"
                  className="w-full rounded-lg border border-white/15 bg-white/[0.06] px-3.5 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-cyan-400/60 focus:border-cyan-400 transition"
                  placeholder="请输入密码"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              {error && (
                <p className="text-sm text-red-300 bg-red-500/10 border border-red-400/30 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}
              <button
                type="submit"
                className="w-full py-2.5 rounded-lg font-medium text-white bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 shadow-[0_4px_20px_rgba(6,182,212,0.35)] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                disabled={loading}
              >
                <LogIn size={16} />
                {loading ? "登录中…" : "登 录"}
              </button>
            </form>
            <p className="text-xs text-slate-500 mt-5 text-center flex items-center justify-center gap-1.5">
              <ShieldCheck size={13} className="text-cyan-500/70" />
              账号由管理员统一开通,如需账号请联系平台管理员
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function SettingsPage() {
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (data.user) {
        setEmail(data.user.email ?? "");
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("id", data.user.id)
          .single();
        setName(profile?.full_name ?? "");
      }
    })();
  }, [supabase]);

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMsg("");
    if (password.length < 6) {
      setError("新密码至少 6 位");
      return;
    }
    if (password !== confirm) {
      setError("两次输入的密码不一致");
      return;
    }
    const { error } = await supabase.auth.updateUser({ password });
    if (error) setError(error.message);
    else {
      setMsg("密码修改成功");
      setPassword("");
      setConfirm("");
    }
  }

  return (
    <div className="max-w-md">
      <h1 className="tech-title text-2xl font-bold mb-1">个人设置</h1>
      <p className="text-sm text-slate-500 mb-4">查看个人信息、修改登录密码</p>

      <div className="card p-5 mb-4">
        <div className="text-sm space-y-2">
          <div className="flex">
            <span className="text-slate-400 w-20">姓名</span>
            <span className="font-medium">{name || "-"}</span>
          </div>
          <div className="flex">
            <span className="text-slate-400 w-20">邮箱</span>
            <span>{email || "-"}</span>
          </div>
        </div>
      </div>

      <form onSubmit={changePassword} className="card p-5 space-y-3">
        <h2 className="font-semibold">修改密码</h2>
        <div>
          <label className="label">新密码</label>
          <input
            type="password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label">确认新密码</label>
          <input
            type="password"
            className="input"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {msg && <p className="text-sm text-emerald-600">{msg}</p>}
        <button className="btn-primary">保存修改</button>
      </form>
    </div>
  );
}

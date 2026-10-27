"use client";

import { useCallback, useEffect, useState } from "react";
import { UserPlus } from "lucide-react";
import type { Profile } from "@/types";

const ROLE_LABEL: Record<string, string> = {
  admin: "管理员",
  teacher: "教师",
  student: "学生",
};

interface NewUser {
  full_name: string;
  email: string;
  password: string;
  role: "teacher" | "student" | "admin";
  student_no: string;
}

const EMPTY: NewUser = {
  full_name: "",
  email: "",
  password: "",
  role: "student",
  student_no: "",
};

export default function UsersPage() {
  const [users, setUsers] = useState<Profile[]>([]);
  const [filter, setFilter] = useState<"all" | "teacher" | "student" | "admin">("all");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<NewUser>(EMPTY);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const r = await fetch("/api/admin/users");
    const d = await r.json();
    setUsers(d.users ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMsg("");
    const r = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const d = await r.json();
    if (!r.ok) {
      setError(d.error ?? "创建失败");
      return;
    }
    setMsg(`账号已开通:${form.email}`);
    setForm(EMPTY);
    setShowCreate(false);
    load();
  }

  async function toggleStatus(u: Profile) {
    await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: u.id,
        action: "set_status",
        status: u.status === "active" ? "disabled" : "active",
      }),
    });
    load();
  }

  async function resetPassword(u: Profile) {
    const pwd = prompt(`为 ${u.email} 设置新密码(至少 6 位):`);
    if (!pwd) return;
    const r = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: u.id, action: "reset_password", password: pwd }),
    });
    const d = await r.json();
    alert(r.ok ? "密码已重置" : d.error ?? "失败");
  }

  async function removeUser(u: Profile) {
    if (!confirm(`确认删除账号 ${u.email}?该操作不可恢复。`)) return;
    const r = await fetch(`/api/admin/users?id=${u.id}`, { method: "DELETE" });
    const d = await r.json();
    if (!r.ok) alert(d.error ?? "删除失败");
    load();
  }

  const shown = users.filter((u) => filter === "all" || u.role === filter);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold">账号管理</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            为教师和学生开通账号、分配权限
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          <UserPlus size={15} />
          开通账号
        </button>
      </div>

      {msg && (
        <p className="text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2 mb-3">
          {msg}
        </p>
      )}

      <div className="flex gap-2 mb-4">
        {(["all", "teacher", "student", "admin"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={filter === f ? "btn-primary" : "btn-secondary"}
          >
            {f === "all" ? "全部" : ROLE_LABEL[f]}
          </button>
        ))}
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="text-left px-4 py-3">姓名</th>
              <th className="text-left px-4 py-3">邮箱</th>
              <th className="text-left px-4 py-3">角色</th>
              <th className="text-left px-4 py-3">学号/工号</th>
              <th className="text-left px-4 py-3">状态</th>
              <th className="text-left px-4 py-3">创建时间</th>
              <th className="text-left px-4 py-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                  加载中…
                </td>
              </tr>
            ) : shown.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                  暂无账号,点击右上角「开通账号」创建
                </td>
              </tr>
            ) : (
              shown.map((u) => (
                <tr key={u.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-medium">{u.full_name}</td>
                  <td className="px-4 py-3 text-slate-500">{u.email}</td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        u.role === "teacher"
                          ? "badge-blue"
                          : u.role === "admin"
                            ? "badge-amber"
                            : "badge-gray"
                      }
                    >
                      {ROLE_LABEL[u.role]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{u.student_no ?? "-"}</td>
                  <td className="px-4 py-3">
                    <span className={u.status === "active" ? "badge-green" : "badge-red"}>
                      {u.status === "active" ? "正常" : "已禁用"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs">
                    {new Date(u.created_at).toLocaleDateString("zh-CN")}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button className="text-blue-600 hover:underline" onClick={() => toggleStatus(u)}>
                        {u.status === "active" ? "禁用" : "启用"}
                      </button>
                      <button className="text-amber-600 hover:underline" onClick={() => resetPassword(u)}>
                        重置密码
                      </button>
                      <button className="text-red-600 hover:underline" onClick={() => removeUser(u)}>
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 创建账号弹窗 */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <form onSubmit={createUser} className="card p-6 w-full max-w-md space-y-3">
            <h2 className="font-bold text-lg">开通账号</h2>
            <div>
              <label className="label">角色</label>
              <select
                className="input"
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as NewUser["role"] })}
              >
                <option value="student">学生</option>
                <option value="teacher">教师</option>
                <option value="admin">管理员</option>
              </select>
            </div>
            <div>
              <label className="label">姓名 *</label>
              <input
                className="input"
                required
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              />
            </div>
            {form.role === "student" && (
              <div>
                <label className="label">学号</label>
                <input
                  className="input"
                  value={form.student_no}
                  onChange={(e) => setForm({ ...form, student_no: e.target.value })}
                />
              </div>
            )}
            <div>
              <label className="label">登录邮箱 *</label>
              <input
                type="email"
                className="input"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div>
              <label className="label">初始密码 *(至少 6 位)</label>
              <input
                className="input"
                required
                minLength={6}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-secondary" onClick={() => setShowCreate(false)}>
                取消
              </button>
              <button type="submit" className="btn-primary">
                开通
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

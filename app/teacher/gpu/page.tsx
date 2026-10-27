"use client";

import { useEffect, useState } from "react";
import { Cpu } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { GpuNode, GpuAllocation, ExperimentSession } from "@/types";

export default function TeacherGpuPage() {
  const supabase = createClient();
  const [nodes, setNodes] = useState<GpuNode[]>([]);
  const [allocs, setAllocs] = useState<GpuAllocation[]>([]);
  const [sessions, setSessions] = useState<ExperimentSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [n, a, s] = await Promise.all([
        supabase.from("gpu_nodes").select("*").order("created_at"),
        supabase
          .from("gpu_allocations")
          .select("*, gpu_nodes(name, gpu_type)")
          .order("allocated_at", { ascending: false })
          .limit(100),
        supabase
          .from("experiment_sessions")
          .select("*, profiles(full_name)")
          .order("started_at", { ascending: false })
          .limit(100),
      ]);
      setNodes((n.data as GpuNode[]) ?? []);
      setAllocs((a.data as GpuAllocation[]) ?? []);
      setSessions((s.data as ExperimentSession[]) ?? []);
      setLoading(false);
    })();
  }, [supabase]);

  async function stopSession(sessionId: string) {
    if (!confirm("确认结束该学生的实验会话并释放 GPU?")) return;
    await fetch("/api/sessions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId }),
    });
    window.location.reload();
  }

  if (loading) return <p className="text-slate-400 text-sm">加载中…</p>;

  const total = nodes.filter((n) => n.status === "online").reduce((s, n) => s + n.gpu_count, 0);
  const used = allocs.filter((a) => a.status === "active").length;

  return (
    <div>
      <h1 className="text-xl font-bold mb-1">GPU 算力</h1>
      <p className="text-sm text-slate-500 mb-4">
        平台云端 GPU 使用情况(由管理员接入),学生开启实验时自动分配空闲算力
      </p>

      <div className="card p-5 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-2xl font-bold">
              {used} <span className="text-sm text-slate-400">/ {total} 卡</span>
            </div>
            <div className="text-xs text-slate-500 mt-1">当前占用 / 在线总卡数</div>
          </div>
          <div className="w-48 h-2.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500"
              style={{ width: `${total ? Math.min(100, (used / total) * 100) : 0}%` }}
            />
          </div>
        </div>
      </div>

      <h2 className="font-semibold mb-3">GPU 节点</h2>
      {nodes.length === 0 ? (
        <div className="card p-8 text-center text-slate-400 mb-6">
          平台还未接入 GPU 节点,请联系管理员在后台接入云端 GPU。
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4 mb-6">
          {nodes.map((n) => {
            const u = allocs.filter((a) => a.node_id === n.id && a.status === "active").length;
            return (
              <div key={n.id} className="card p-4">
                <div className="flex justify-between items-center">
                  <div className="font-medium text-sm flex items-center gap-1.5">
                    <Cpu size={14} className="text-blue-600" />
                    {n.name}
                    <span className={n.status === "online" ? "badge-green ml-2" : "badge-red ml-2"}>
                      {n.status === "online" ? "在线" : "离线"}
                    </span>
                  </div>
                  <span className="text-sm">
                    {u}/{n.gpu_count}
                  </span>
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  {n.gpu_type} · {n.gpu_memory ?? "-"} · {n.provider}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <h2 className="font-semibold mb-3">学生的实验会话</h2>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="text-left px-4 py-3">学生</th>
              <th className="text-left px-4 py-3">GPU</th>
              <th className="text-left px-4 py-3">状态</th>
              <th className="text-left px-4 py-3">开始时间</th>
              <th className="text-left px-4 py-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {sessions.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  暂无实验会话
                </td>
              </tr>
            ) : (
              sessions.map((s) => (
                <tr key={s.id} className="border-t border-slate-100">
                  <td className="px-4 py-3">{s.profiles?.full_name ?? "-"}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{s.gpu_label || "-"}</td>
                  <td className="px-4 py-3">
                    <span className={s.status === "running" ? "badge-green" : "badge-gray"}>
                      {s.status === "running" ? "运行中" : "已结束"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {new Date(s.started_at).toLocaleString("zh-CN")}
                  </td>
                  <td className="px-4 py-3">
                    {s.status === "running" && (
                      <button className="text-red-600 hover:underline text-xs" onClick={() => stopSession(s.id)}>
                        结束并释放 GPU
                      </button>
                    )}
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

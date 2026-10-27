"use client";

import { useCallback, useEffect, useState } from "react";
import { Cpu, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { GpuAllocation, GpuNode } from "@/types";

interface NodeForm {
  name: string;
  provider: string;
  endpoint: string;
  spawner_url: string;
  gpu_type: string;
  gpu_count: number;
  gpu_memory: string;
  region: string;
  notes: string;
}

const EMPTY: NodeForm = {
  name: "",
  provider: "阿里云",
  endpoint: "",
  spawner_url: "http://",
  gpu_type: "A100",
  gpu_count: 1,
  gpu_memory: "80GB",
  region: "",
  notes: "",
};

export default function AdminGpuPage() {
  const supabase = createClient();
  const [nodes, setNodes] = useState<GpuNode[]>([]);
  const [allocs, setAllocs] = useState<GpuAllocation[]>([]);
  const [form, setForm] = useState<NodeForm>(EMPTY);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [n, a] = await Promise.all([
      supabase.from("gpu_nodes").select("*").order("created_at", { ascending: false }),
      supabase
        .from("gpu_allocations")
        .select("*, gpu_nodes(name, gpu_type)")
        .order("allocated_at", { ascending: false })
        .limit(50),
    ]);
    setNodes((n.data as GpuNode[]) ?? []);
    setAllocs((a.data as GpuAllocation[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function createNode(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const { error } = await supabase.from("gpu_nodes").insert({
      name: form.name,
      provider: form.provider,
      endpoint: form.endpoint || null,
      spawner_url: form.spawner_url || null,
      gpu_type: form.gpu_type,
      gpu_count: Number(form.gpu_count),
      gpu_memory: form.gpu_memory || null,
      region: form.region || null,
      notes: form.notes || null,
    });
    if (error) setError(error.message);
    else {
      setShowForm(false);
      setForm(EMPTY);
      load();
    }
  }

  async function toggleStatus(node: GpuNode) {
    const next =
      node.status === "online" ? "offline" : "online";
    await supabase.from("gpu_nodes").update({ status: next }).eq("id", node.id);
    load();
  }

  async function removeNode(node: GpuNode) {
    if (!confirm(`确认删除节点 ${node.name}?相关分配记录将一并删除。`)) return;
    await supabase.from("gpu_nodes").delete().eq("id", node.id);
    load();
  }

  function usedOf(node: GpuNode) {
    return allocs.filter(
      (a) => a.node_id === node.id && a.status === "active"
    ).length;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="tech-title text-2xl font-bold">GPU 资源池</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            接入云端 GPU 服务器,平台将自动为实验会话分配空闲算力
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm(true)}>
          <Plus size={15} />
          接入 GPU 节点
        </button>
      </div>

      {loading ? (
        <p className="text-slate-400 text-sm">加载中…</p>
      ) : nodes.length === 0 ? (
        <div className="card p-10 text-center text-slate-400">
          
          还没有接入 GPU 节点。点击「接入 GPU 节点」登记云端 GPU 服务器信息
          (节点地址用于 JupyterLab 会话接入)。
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {nodes.map((node) => {
            const used = usedOf(node);
            return (
              <div key={node.id} className="card p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-semibold flex items-center gap-2">
                      <Cpu size={14} className="text-blue-600" />
                      {node.name}
                      <span className={node.status === "online" ? "badge-green" : "badge-red"}>
                        {node.status === "online" ? "在线" : node.status === "offline" ? "离线" : "维护中"}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      {node.provider} · {node.gpu_type} · {node.gpu_memory ?? "-"}
                      {node.region ? ` · ${node.region}` : ""}
                    </div>
                    {node.spawner_url && (
                      <div className="text-xs text-emerald-600 mt-0.5 truncate max-w-xs">
                        Spawner:{node.spawner_url}
                      </div>
                    )}
                    {node.endpoint && (
                      <div className="text-xs text-slate-400 mt-0.5 truncate max-w-xs">
                        端点:{node.endpoint}
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold">
                      {used}
                      <span className="text-sm text-slate-400">/{node.gpu_count}</span>
                    </div>
                    <div className="text-xs text-slate-400">已用/总卡数</div>
                  </div>
                </div>
                <div className="h-2 bg-slate-100 rounded-full mt-3 overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full"
                    style={{ width: `${Math.min(100, (used / node.gpu_count) * 100)}%` }}
                  />
                </div>
                <div className="flex gap-2 mt-3">
                  <button className="btn-secondary text-xs" onClick={() => toggleStatus(node)}>
                    {node.status === "online" ? "设为离线" : "设为在线"}
                  </button>
                  <button className="btn-danger text-xs" onClick={() => removeNode(node)}>
                    删除节点
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <h2 className="font-semibold mt-8 mb-3">最近分配记录</h2>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="text-left px-4 py-2.5">节点</th>
              <th className="text-left px-4 py-2.5">卡号</th>
              <th className="text-left px-4 py-2.5">状态</th>
              <th className="text-left px-4 py-2.5">分配时间</th>
              <th className="text-left px-4 py-2.5">释放时间</th>
            </tr>
          </thead>
          <tbody>
            {allocs.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                  暂无分配记录
                </td>
              </tr>
            ) : (
              allocs.map((a) => (
                <tr key={a.id} className="border-t border-slate-100">
                  <td className="px-4 py-2.5">{a.gpu_nodes?.name ?? "-"}</td>
                  <td className="px-4 py-2.5">GPU {a.gpu_index}</td>
                  <td className="px-4 py-2.5">
                    <span className={a.status === "active" ? "badge-green" : "badge-gray"}>
                      {a.status === "active" ? "占用中" : "已释放"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-500 text-xs">
                    {new Date(a.allocated_at).toLocaleString("zh-CN")}
                  </td>
                  <td className="px-4 py-2.5 text-slate-500 text-xs">
                    {a.released_at ? new Date(a.released_at).toLocaleString("zh-CN") : "-"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <form onSubmit={createNode} className="card p-6 w-full max-w-md space-y-3">
            <h2 className="font-bold text-lg">接入 GPU 节点</h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="label">节点名称 *</label>
                <input
                  className="input"
                  required
                  placeholder="如:阿里云-GPU训练服务器-01"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div>
                <label className="label">云服务商</label>
                <input
                  className="input"
                  value={form.provider}
                  onChange={(e) => setForm({ ...form, provider: e.target.value })}
                />
              </div>
              <div>
                <label className="label">GPU 型号</label>
                <input
                  className="input"
                  value={form.gpu_type}
                  onChange={(e) => setForm({ ...form, gpu_type: e.target.value })}
                />
              </div>
              <div>
                <label className="label">卡数 *</label>
                <input
                  type="number"
                  min={1}
                  className="input"
                  required
                  value={form.gpu_count}
                  onChange={(e) => setForm({ ...form, gpu_count: Number(e.target.value) })}
                />
              </div>
              <div>
                <label className="label">单卡显存</label>
                <input
                  className="input"
                  value={form.gpu_memory}
                  onChange={(e) => setForm({ ...form, gpu_memory: e.target.value })}
                />
              </div>
              <div className="col-span-2">
                <label className="label">开通服务地址(Spawner, 推荐)</label>
                <input
                  className="input"
                  placeholder="http://<GPU服务器IP>:9000"
                  value={form.spawner_url}
                  onChange={(e) => setForm({ ...form, spawner_url: e.target.value })}
                />
                <p className="text-xs text-slate-400 mt-1">
                  在 GPU 机器上部署的 spawner 服务地址。配置后, 学生开启实验会在该机器上自动创建
                  绑定指定卡号的 JupyterLab 容器, 并按时长自动回收。
                </p>
              </div>
              <div className="col-span-2">
                <label className="label">Jupyter 网关地址(兼容模式, 仅在无常驻 spawner 时使用)</label>
                <input
                  className="input"
                  placeholder="http://<GPU服务器IP>:8888"
                  value={form.endpoint}
                  onChange={(e) => setForm({ ...form, endpoint: e.target.value })}
                />
              </div>
              <div className="col-span-2">
                <label className="label">地域</label>
                <input
                  className="input"
                  value={form.region}
                  onChange={(e) => setForm({ ...form, region: e.target.value })}
                />
              </div>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>
                取消
              </button>
              <button type="submit" className="btn-primary">
                接入
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

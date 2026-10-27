"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { FlaskConical, FolderOpen, Users, Plus, Upload, Cpu } from "lucide-react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { toProxyPath } from "@/lib/supabase/proxy";
import type {
  Course,
  Experiment,
  Material,
  CourseEnrollment,
  StepProgress,
  ExperimentSession,
  ExperimentStep,
} from "@/types";

type Tab = "materials" | "experiments" | "students";

export default function CourseDetailPage() {
  const params = useParams();
  const courseId = params.id as string;
  const supabase = createClient();

  const [tab, setTab] = useState<Tab>("experiments");
  const [course, setCourse] = useState<Course | null>(null);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [exps, setExps] = useState<Experiment[]>([]);
  const [steps, setSteps] = useState<ExperimentStep[]>([]);
  const [students, setStudents] = useState<CourseEnrollment[]>([]);
  const [progress, setProgress] = useState<StepProgress[]>([]);
  const [sessions, setSessions] = useState<ExperimentSession[]>([]);
  const [loading, setLoading] = useState(true);

  // 上传表单
  const [uploading, setUploading] = useState(false);
  const [fileTitle, setFileTitle] = useState("");
  const [fileDesc, setFileDesc] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // 实验表单
  const [showExp, setShowExp] = useState(false);
  const [expForm, setExpForm] = useState({
    title: "",
    description: "",
    objectives: "",
    reference_code: "",
    steps_text: "",
    expected_output: "",
    gpu_node_id: "",
    type: "jupyter" as "jupyter" | "quick_train",
    gpu_required: false,
    gpu_count: 1,
    duration_minutes: 120,
    deadline: "",
  });
  const [error, setError] = useState("");
  const [gpuNodes, setGpuNodes] = useState<{ id: string; name: string; gpu_type: string; gpu_count: number }[]>([]);

  const load = useCallback(async () => {
    const [c, m, e, s, en, p, sess] = await Promise.all([
      supabase.from("courses").select("*").eq("id", courseId).maybeSingle(),
      supabase
        .from("materials")
        .select("*")
        .eq("course_id", courseId)
        .order("created_at", { ascending: false }),
      supabase
        .from("experiments")
        .select("*")
        .eq("course_id", courseId)
        .order("created_at", { ascending: false }),
      supabase
        .from("experiment_steps")
        .select("id, experiment_id, step_order")
        .in(
          "experiment_id",
          (await supabase.from("experiments").select("id").eq("course_id", courseId))
            .data?.map((x) => x.id) ?? ["00000000-0000-0000-0000-000000000000"]
        ),
      supabase
        .from("course_enrollments")
        .select("*, profiles(full_name, student_no, email)")
        .eq("course_id", courseId),
      supabase
        .from("step_progress")
        .select("*")
        .in(
          "experiment_id",
          (await supabase.from("experiments").select("id").eq("course_id", courseId))
            .data?.map((x) => x.id) ?? ["00000000-0000-0000-0000-000000000000"]
        ),
      supabase
        .from("experiment_sessions")
        .select("*, profiles(full_name)")
        .in(
          "experiment_id",
          (await supabase.from("experiments").select("id").eq("course_id", courseId))
            .data?.map((x) => x.id) ?? ["00000000-0000-0000-0000-000000000000"]
        )
        .order("started_at", { ascending: false })
        .limit(100),
    ]);
    setCourse((c.data as Course) ?? null);
    setMaterials((m.data as Material[]) ?? []);
    setExps((e.data as Experiment[]) ?? []);
    setSteps((s.data as ExperimentStep[]) ?? []);
    setStudents((en.data as CourseEnrollment[]) ?? []);
    setProgress((p.data as StepProgress[]) ?? []);
    setSessions((sess.data as ExperimentSession[]) ?? []);
    setLoading(false);
  }, [courseId, supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleUpload() {
    if (!selectedFile) return;
    setUploading(true);
    setError("");
    const path = `${courseId}/${Date.now()}-${selectedFile.name}`;
    const { error: upErr } = await supabase.storage
      .from("materials")
      .upload(path, selectedFile);
    if (upErr) {
      setError("上传失败:" + upErr.message);
      setUploading(false);
      return;
    }
    await supabase.from("materials").insert({
      course_id: courseId,
      title: fileTitle || selectedFile.name,
      description: fileDesc,
      file_path: path,
      file_name: selectedFile.name,
      file_size: selectedFile.size,
      file_type: selectedFile.type,
    });
    setSelectedFile(null);
    setFileTitle("");
    setFileDesc("");
    setUploading(false);
    load();
  }

  async function download(m: Material) {
    const { data } = await supabase.storage
      .from("materials")
      .createSignedUrl(m.file_path, 300);
    if (data?.signedUrl) window.open(toProxyPath(data.signedUrl), "_blank");
  }

  async function removeMaterial(m: Material) {
    if (!confirm(`删除资料「${m.title}」?`)) return;
    await supabase.storage.from("materials").remove([m.file_path]);
    await supabase.from("materials").delete().eq("id", m.id);
    load();
  }

  async function loadGpuNodes() {
    const { data } = await supabase
      .from("gpu_nodes")
      .select("id, name, gpu_type, gpu_count")
      .eq("status", "online")
      .order("created_at");
    setGpuNodes((data as typeof gpuNodes) ?? []);
  }

  async function createExperiment(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const { data: user } = await supabase.auth.getUser();
    const { data: created, error } = await supabase
      .from("experiments")
      .insert({
        course_id: courseId,
        teacher_id: user.user!.id,
        title: expForm.title,
        description: expForm.description,
        objectives: expForm.objectives,
        reference_code: expForm.reference_code,
        expected_output: expForm.expected_output,
        gpu_node_id: expForm.gpu_node_id || null,
        type: expForm.type,
        gpu_required: expForm.gpu_required,
        gpu_count: Number(expForm.gpu_count) || 1,
        duration_minutes: Number(expForm.duration_minutes) || 120,
        deadline: expForm.deadline || null,
        status: "published",
      })
      .select("id")
      .single();
    if (error) {
      setError(error.message);
      return;
    }
    // 解析实验步骤: 每行一个步骤, 可用「:」或「：」分隔标题与说明
    const stepLines = expForm.steps_text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (created && stepLines.length) {
      await supabase.from("experiment_steps").insert(
        stepLines.map((line, i) => {
          const m = line.match(/^(.{1,40}?)[:：]\s*(.+)$/);
          return {
            experiment_id: created.id,
            step_order: i + 1,
            title: m ? m[1] : line,
            content: line,
            hint: "",
          };
        })
      );
    }
    setShowExp(false);
    setExpForm({
      title: "",
      description: "",
      objectives: "",
      reference_code: "",
      steps_text: "",
      expected_output: "",
      gpu_node_id: "",
      type: "jupyter",
      gpu_required: false,
      gpu_count: 1,
      duration_minutes: 120,
      deadline: "",
    });
    load();
  }

  async function toggleExpStatus(exp: Experiment) {
    const next =
      exp.status === "published" ? "closed" : "published";
    await supabase.from("experiments").update({ status: next }).eq("id", exp.id);
    load();
  }

  if (loading) return <p className="text-slate-400 text-sm">加载中…</p>;
  if (!course)
    return <p className="text-slate-500">课程不存在或无权访问。</p>;

  const totalStepsOf = (expId: string) =>
    steps.filter((s) => s.experiment_id === expId).length;

  return (
    <div>
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2">
            <Link href="/teacher" className="text-slate-400 hover:text-slate-600 text-sm">
              ← 我的课程
            </Link>
          </div>
          <h1 className="text-xl font-bold mt-1">{course.name}</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            邀请码
            <span className="font-mono bg-slate-100 rounded px-1.5 py-0.5 mx-1">
              {course.invite_code}
            </span>
            · 学生 {students.length} 人 · GPU 配额 {course.gpu_quota} 卡
          </p>
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        {(
          [
            ["experiments", "实验管理"],
            ["materials", "教学资料"],
            ["students", "学生进度"],
          ] as [Tab, string][]
        ).map(([key, label]) => {
          const TabIcon =
            key === "experiments" ? FlaskConical : key === "materials" ? FolderOpen : Users;
          return (
          <button
            key={key}
            className={tab === key ? "btn-primary" : "btn-secondary"}
            onClick={() => setTab(key)}
          >
            <TabIcon size={15} />
            {label}
          </button>
          );
        })}
      </div>

      {/* 实验管理 */}
      {tab === "experiments" && (
        <div>
          <div className="flex justify-end mb-3">
            <button className="btn-primary" onClick={() => { setShowExp(true); loadGpuNodes(); }}>
              <Plus size={15} />
              开设实验
            </button>
          </div>
          {exps.length === 0 ? (
            <div className="card p-10 text-center text-slate-400">
              还没有实验。开设实验后,为学生添加实验步骤,学生即可按步骤学习。
            </div>
          ) : (
            <div className="space-y-3">
              {exps.map((exp) => (
                <div key={exp.id} className="card p-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/teacher/experiments/${exp.id}`}
                          className="font-semibold text-base hover:text-blue-600"
                        >
                          {exp.title}
                        </Link>
                        <span className={exp.status === "published" ? "badge-green" : exp.status === "draft" ? "badge-gray" : "badge-red"}>
                          {exp.status === "published" ? "已发布" : exp.status === "draft" ? "草稿" : "已关闭"}
                        </span>
                        {exp.gpu_required && <span className="badge-blue"><Cpu size={12} className="inline" /> GPU ×{exp.gpu_count}</span>}
                        <span className="badge-gray">{exp.type === "jupyter" ? "JupyterLab 实验" : "在线训练实验"}</span>
                      </div>
                      <p className="text-sm text-slate-500 mt-1.5">{exp.description || "暂无说明"}</p>
                      <div className="text-xs text-slate-400 mt-2">
                        步骤 {totalStepsOf(exp.id)} 个
                        {exp.deadline ? ` · 截止 ${new Date(exp.deadline).toLocaleDateString("zh-CN")}` : ""}
                        · 时长 {exp.duration_minutes} 分钟
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <Link href={`/teacher/experiments/${exp.id}`} className="btn-primary text-xs">
                        管理步骤 / 进度
                      </Link>
                      <button className="btn-secondary text-xs" onClick={() => toggleExpStatus(exp)}>
                        {exp.status === "published" ? "关闭实验" : "重新开放"}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 教学资料 */}
      {tab === "materials" && (
        <div>
          <div className="card p-5 mb-4">
            <h3 className="font-semibold mb-3 flex items-center gap-2"><Upload size={16} className="text-blue-600" /> 上传资料</h3>
            <div className="grid md:grid-cols-3 gap-3">
              <input
                className="input"
                placeholder="资料标题(留空则用文件名)"
                value={fileTitle}
                onChange={(e) => setFileTitle(e.target.value)}
              />
              <input
                className="input"
                placeholder="备注说明"
                value={fileDesc}
                onChange={(e) => setFileDesc(e.target.value)}
              />
              <input
                type="file"
                className="input py-1.5"
                onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
              />
            </div>
            {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
            <div className="flex justify-end mt-3">
              <button className="btn-primary" disabled={!selectedFile || uploading} onClick={handleUpload}>
                {uploading ? "上传中…" : "上传到课程"}
              </button>
            </div>
          </div>

          {materials.length === 0 ? (
            <div className="card p-10 text-center text-slate-400">还没有上传资料</div>
          ) : (
            <div className="card divide-y divide-slate-100">
              {materials.map((m) => (
                <div key={m.id} className="flex items-center justify-between px-5 py-3">
                  <div>
                    <div className="font-medium text-sm">{m.title}</div>
                    <div className="text-xs text-slate-400">
                      {m.file_name} ·{" "}
                      {m.file_size ? `${(m.file_size / 1024).toFixed(1)} KB` : "-"} ·{" "}
                      {new Date(m.created_at).toLocaleString("zh-CN")}
                      {m.description ? ` · ${m.description}` : ""}
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <button className="text-blue-600 hover:underline text-sm" onClick={() => download(m)}>
                      下载
                    </button>
                    <button className="text-red-600 hover:underline text-sm" onClick={() => removeMaterial(m)}>
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 学生进度 */}
      {tab === "students" && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="text-left px-4 py-3">学生</th>
                <th className="text-left px-4 py-3">学号</th>
                <th className="text-left px-4 py-3">加入时间</th>
                <th className="text-left px-4 py-3">实验进度</th>
                <th className="text-left px-4 py-3">当前状态</th>
              </tr>
            </thead>
            <tbody>
              {students.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                    还没有学生加入,把邀请码 {course.invite_code} 发给学生
                  </td>
                </tr>
              ) : (
                students.map((en) => {
                  const st = en.profiles as CourseEnrollment["profiles"];
                  const doneSteps = progress.filter(
                    (p) => p.student_id === en.student_id && p.completed
                  ).length;
                  const totalSteps = exps.reduce((s, e) => s + totalStepsOf(e.id), 0);
                  const running = sessions.some(
                    (s) => s.student_id === en.student_id && s.status === "running"
                  );
                  const pct = totalSteps ? Math.round((doneSteps / totalSteps) * 100) : 0;
                  return (
                    <tr key={en.id} className="border-t border-slate-100">
                      <td className="px-4 py-3 font-medium">{st?.full_name ?? "-"}</td>
                      <td className="px-4 py-3 text-slate-500">{st?.student_no ?? "-"}</td>
                      <td className="px-4 py-3 text-slate-400 text-xs">
                        {new Date(en.joined_at).toLocaleDateString("zh-CN")}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-28 h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs text-slate-500">
                            {doneSteps}/{totalSteps} 步
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {running ? (
                          <span className="badge-green">⚡ 实验中</span>
                        ) : (
                          <span className="badge-gray">离线</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* 开设实验弹窗 */}
      {showExp && (
        <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <form
            onSubmit={createExperiment}
            className="card p-6 w-full max-w-2xl space-y-3 my-6 max-h-[88vh] overflow-y-auto"
          >
            <h2 className="font-bold text-lg">开设实验</h2>
            <div>
              <label className="label">实验名称 *</label>
              <input
                className="input"
                required
                placeholder="如:实验一 - 线性回归预测房价"
                value={expForm.title}
                onChange={(e) => setExpForm({ ...expForm, title: e.target.value })}
              />
            </div>
            <div>
              <label className="label">实验说明</label>
              <textarea
                className="input"
                rows={2}
                value={expForm.description}
                onChange={(e) => setExpForm({ ...expForm, description: e.target.value })}
              />
            </div>
            <div>
              <label className="label">实验目标(将出现在实验指导书 PDF 中)</label>
              <textarea
                className="input"
                rows={3}
                placeholder={"每行一条目标,例如:\n1. 理解线性回归的原理\n2. 掌握 sklearn 建模流程"}
                value={expForm.objectives}
                onChange={(e) => setExpForm({ ...expForm, objectives: e.target.value })}
              />
            </div>
            <div>
              <label className="label">实验代码(参考答案,仅用于平台验证,不会出现在指导书中)</label>
              <textarea
                className="input font-mono text-xs"
                rows={8}
                placeholder={`学生将按行手动输入,每行可用 # 写引导注释,例如:\nfrom sklearn.datasets import load_iris  # 加载鸢尾花数据集\nmodel = LogisticRegression()  # 创建逻辑回归模型\nmodel.fit(X_train, y_train)  # 训练模型\n\n# 空行和整行注释不要求学生输入`}
                value={expForm.reference_code}
                onChange={(e) => setExpForm({ ...expForm, reference_code: e.target.value })}
              />
              <p className="text-xs text-slate-400 mt-1">
                发布后学生端会生成 PDF 指导书(名称/目标/步骤),学生须按行手动输入代码(禁止粘贴),
                平台逐行校验其与参考答案的一致性。
              </p>
            </div>
            <div>
              <label className="label">实验步骤(每行一步,自动生成步骤引导)</label>
              <textarea
                className="input"
                rows={5}
                placeholder={"每行一个步骤,可用「:」分隔标题与说明,例如:\n加载数据集:使用 load_iris 加载鸢尾花数据\n划分数据集:按 7:3 划分训练集与测试集\n训练模型:创建逻辑回归并用训练集拟合\n评估结果:输出测试集准确率"}
                value={expForm.steps_text}
                onChange={(e) => setExpForm({ ...expForm, steps_text: e.target.value })}
              />
              <p className="text-xs text-slate-400 mt-1">
                创建后也可在实验详情页继续编辑步骤。
              </p>
            </div>
            <div>
              <label className="label">
                预期输出(学生代码在 Jupyter 内核真实运行后的标准输出与此项比对,留空则只做代码一致性校验)
              </label>
              <textarea
                className="input font-mono text-xs"
                rows={3}
                placeholder={"例如:\n测试集准确率: 0.9556"}
                value={expForm.expected_output}
                onChange={(e) => setExpForm({ ...expForm, expected_output: e.target.value })}
              />
              <p className="text-xs text-slate-400 mt-1">
                配置后,学生提交的代码将由平台 Jupyter 内核真实运行,输出与此项比对以判定实验结果。
              </p>
            </div>
            <div>
              <label className="label">运行节点(GPU / Jupyter 内核)</label>
              <select
                className="input"
                value={expForm.gpu_node_id}
                onChange={(e) => setExpForm({ ...expForm, gpu_node_id: e.target.value })}
              >
                <option value="">自动分配(推荐)</option>
                {gpuNodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name} · {n.gpu_type} ×{n.gpu_count}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-400 mt-1">
                指定后,该实验的会话将固定在此节点运行;节点离线或卡满时无法开启实验。
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">实验类型</label>
                <select
                  className="input"
                  value={expForm.type}
                  onChange={(e) =>
                    setExpForm({ ...expForm, type: e.target.value as "jupyter" | "quick_train" })
                  }
                >
                  <option value="jupyter">JupyterLab 实验(云端 GPU)</option>
                  <option value="quick_train">在线训练实验(平台内置)</option>
                </select>
              </div>
              <div>
                <label className="label">截止时间</label>
                <input
                  type="date"
                  className="input"
                  value={expForm.deadline}
                  onChange={(e) => setExpForm({ ...expForm, deadline: e.target.value })}
                />
              </div>
              <div>
                <label className="label">需要 GPU</label>
                <select
                  className="input"
                  value={expForm.gpu_required ? "1" : "0"}
                  onChange={(e) => setExpForm({ ...expForm, gpu_required: e.target.value === "1" })}
                >
                  <option value="0">不需要</option>
                  <option value="1">需要(开启时自动分配)</option>
                </select>
              </div>
              <div>
                <label className="label">GPU 卡数</label>
                <input
                  type="number"
                  min={1}
                  className="input"
                  value={expForm.gpu_count}
                  disabled={!expForm.gpu_required}
                  onChange={(e) => setExpForm({ ...expForm, gpu_count: Number(e.target.value) })}
                />
              </div>
              <div>
                <label className="label">会话时长(分钟)</label>
                <input
                  type="number"
                  min={10}
                  className="input"
                  value={expForm.duration_minutes}
                  onChange={(e) =>
                    setExpForm({ ...expForm, duration_minutes: Number(e.target.value) })
                  }
                />
              </div>
            </div>
            <p className="text-xs text-slate-400">
              创建后请在实验详情中添加实验步骤,学生将按步骤完成学习。
            </p>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-secondary" onClick={() => setShowExp(false)}>
                取消
              </button>
              <button type="submit" className="btn-primary">创建并发布</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

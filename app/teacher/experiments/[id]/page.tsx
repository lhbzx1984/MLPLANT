"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Cpu, FileText, Lightbulb } from "lucide-react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type {
  Experiment,
  ExperimentStep,
  CourseEnrollment,
  StepProgress,
  ExperimentSession,
  ExperimentReport,
  CodeSubmission,
} from "@/types";

export default function ExperimentDetailPage() {
  const params = useParams();
  const experimentId = params.id as string;
  const supabase = createClient();

  const [exp, setExp] = useState<Experiment | null>(null);
  const [steps, setSteps] = useState<ExperimentStep[]>([]);
  const [students, setStudents] = useState<CourseEnrollment[]>([]);
  const [progress, setProgress] = useState<StepProgress[]>([]);
  const [sessions, setSessions] = useState<ExperimentSession[]>([]);
  const [reports, setReports] = useState<ExperimentReport[]>([]);
  const [submissions, setSubmissions] = useState<CodeSubmission[]>([]);
  const [loading, setLoading] = useState(true);

  // 实验目标 / 参考代码 编辑
  const [expEdit, setExpEdit] = useState({ objectives: "", reference_code: "", expected_output: "" });
  const [savingInfo, setSavingInfo] = useState(false);

  // 步骤编辑
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ title: "", content: "", hint: "" });
  const [showAdd, setShowAdd] = useState(false);
  const [newStep, setNewStep] = useState({ title: "", content: "", hint: "" });

  const load = useCallback(async () => {
    const [e, s, en, p, sess, r, sub] = await Promise.all([
      supabase.from("experiments").select("*").eq("id", experimentId).maybeSingle(),
      supabase
        .from("experiment_steps")
        .select("*")
        .eq("experiment_id", experimentId)
        .order("step_order"),
      supabase
        .from("course_enrollments")
        .select("*, profiles(full_name, student_no)")
        .eq("course_id", (await supabase.from("experiments").select("course_id").eq("id", experimentId).single()).data?.course_id ?? ""),
      supabase.from("step_progress").select("*").eq("experiment_id", experimentId),
      supabase
        .from("experiment_sessions")
        .select("*, profiles(full_name)")
        .eq("experiment_id", experimentId)
        .order("started_at", { ascending: false })
        .limit(100),
      supabase
        .from("experiment_reports")
        .select("*, profiles(full_name)")
        .eq("experiment_id", experimentId)
        .order("submitted_at", { ascending: false }),
      supabase
        .from("code_submissions")
        .select("*, profiles(full_name, student_no)")
        .eq("experiment_id", experimentId)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    setExp((e.data as Experiment) ?? null);
    if (e.data) {
      setExpEdit({
        objectives: (e.data as Experiment).objectives ?? "",
        reference_code: (e.data as Experiment).reference_code ?? "",
        expected_output: (e.data as Experiment).expected_output ?? "",
      });
    }
    setSteps((s.data as ExperimentStep[]) ?? []);
    setStudents((en.data as CourseEnrollment[]) ?? []);
    setProgress((p.data as StepProgress[]) ?? []);
    setSessions((sess.data as ExperimentSession[]) ?? []);
    setReports((r.data as ExperimentReport[]) ?? []);
    setSubmissions((sub.data as CodeSubmission[]) ?? []);
    setLoading(false);
  }, [experimentId, supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function addStep(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.from("experiment_steps").insert({
      experiment_id: experimentId,
      step_order: steps.length + 1,
      title: newStep.title,
      content: newStep.content,
      hint: newStep.hint,
    });
    if (!error) {
      setNewStep({ title: "", content: "", hint: "" });
      setShowAdd(false);
      load();
    }
  }

  async function saveStep(step: ExperimentStep) {
    await supabase
      .from("experiment_steps")
      .update({ title: draft.title, content: draft.content, hint: draft.hint })
      .eq("id", step.id);
    setEditing(null);
    load();
  }

  async function removeStep(step: ExperimentStep) {
    if (!confirm(`删除步骤「${step.title}」?`)) return;
    await supabase.from("experiment_steps").delete().eq("id", step.id);
    // 重排
    const rest = steps.filter((s) => s.id !== step.id);
    for (let i = 0; i < rest.length; i++) {
      if (rest[i].step_order !== i + 1) {
        await supabase
          .from("experiment_steps")
          .update({ step_order: i + 1 })
          .eq("id", rest[i].id);
      }
    }
    load();
  }

  async function saveExpInfo() {
    setSavingInfo(true);
    await supabase
      .from("experiments")
      .update({
        objectives: expEdit.objectives,
        reference_code: expEdit.reference_code,
        expected_output: expEdit.expected_output,
      })
      .eq("id", experimentId);
    setSavingInfo(false);
    load();
  }

  async function grade(report: ExperimentReport, score: number, feedback: string) {
    await supabase
      .from("experiment_reports")
      .update({ score, feedback, graded_at: new Date().toISOString() })
      .eq("id", report.id);
    load();
  }

  if (loading) return <p className="text-slate-400 text-sm">加载中…</p>;
  if (!exp) return <p className="text-slate-500">实验不存在或无权访问。</p>;

  return (
    <div>
      <Link href={`/teacher/courses/${exp.course_id}`} className="text-slate-400 hover:text-slate-600 text-sm">
        ← 返回课程
      </Link>
      <div className="flex items-start justify-between mt-1 mb-4">
        <div>
          <h1 className="text-xl font-bold">{exp.title}</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {exp.description || "暂无说明"}
          </p>
          <div className="flex gap-2 mt-2">
            <span className={exp.status === "published" ? "badge-green" : "badge-red"}>
              {exp.status === "published" ? "已发布" : "已关闭"}
            </span>
            {exp.gpu_required && <span className="badge-blue"><span className="inline-flex items-center gap-1"><Cpu size={12} /> 需要 GPU ×{exp.gpu_count}</span></span>}
            <span className="badge-gray">{exp.type === "jupyter" ? "JupyterLab 实验" : "在线训练实验"}</span>
          </div>
        </div>
        <a
          href={`/api/experiments/${experimentId}/guide`}
          target="_blank"
          rel="noreferrer"
          className="btn-secondary shrink-0"
        >
          <FileText size={14} /> 预览指导书 PDF
        </a>
      </div>

      {/* ===== 实验目标与参考代码 ===== */}
      <div className="card p-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">实验目标与参考代码</h2>
          <button className="btn-primary text-xs" onClick={saveExpInfo} disabled={savingInfo}>
            {savingInfo ? "保存中…" : "保存修改"}
          </button>
        </div>
        <div className="grid lg:grid-cols-2 gap-4">
          <div>
            <label className="label">实验目标(每行一条,写入指导书 PDF)</label>
            <textarea
              className="input"
              rows={8}
              placeholder={"例如:\n1. 理解逻辑回归的原理\n2. 掌握 sklearn 建模与评估流程"}
              value={expEdit.objectives}
              onChange={(e) => setExpEdit({ ...expEdit, objectives: e.target.value })}
            />
          </div>
          <div>
            <label className="label">
              实验代码(参考答案,学生看不到;行尾 # 注释会作为引导展示)
            </label>
            <textarea
              className="input font-mono text-xs"
              rows={8}
              spellCheck={false}
              placeholder={"例如:\nfrom sklearn.datasets import load_iris  # 加载鸢尾花数据集\nmodel = LogisticRegression()  # 创建模型\nmodel.fit(X_train, y_train)  # 训练"}
              value={expEdit.reference_code}
              onChange={(e) => setExpEdit({ ...expEdit, reference_code: e.target.value })}
            />
            <p className="text-xs text-slate-400 mt-1">
              空行与整行注释不要求学生输入;学生须逐行手动输入(禁止粘贴),平台按行校验。
            </p>
            </div>
          </div>
          <div className="mt-4">
            <label className="label">
              预期输出(学生代码在 Jupyter 内核真实运行后的标准输出与此项比对;留空则只做代码一致性校验)
            </label>
            <textarea
              className="input font-mono text-xs"
              rows={4}
              placeholder={"例如:\n测试集准确率: 0.9556"}
              value={expEdit.expected_output}
              onChange={(e) => setExpEdit({ ...expEdit, expected_output: e.target.value })}
            />
            <p className="text-xs text-slate-400 mt-1">
              配置后,学生点击「运行代码并验证输出」时,平台将在 Jupyter 内核中真实运行其代码并比对输出。
            </p>
          </div>
      </div>

      {/* ===== 实验步骤 ===== */}
      <div className="card p-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">实验步骤({steps.length})</h2>
          <button className="btn-primary text-xs" onClick={() => setShowAdd(true)}>
            添加步骤
          </button>
        </div>

        {steps.length === 0 && (
          <p className="text-sm text-slate-400 py-4 text-center">
            还没有步骤。为学生添加逐步引导,例如:① 加载数据 → ② 训练模型 → ③ 评估并提交报告
          </p>
        )}

        <div className="space-y-3">
          {steps.map((step) => (
            <div key={step.id} className="border border-slate-200 rounded-lg p-4">
              {editing === step.id ? (
                <div className="space-y-2">
                  <input
                    className="input"
                    value={draft.title}
                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  />
                  <textarea
                    className="input font-mono"
                    rows={5}
                    placeholder="步骤内容,支持 Markdown"
                    value={draft.content}
                    onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                  />
                  <input
                    className="input"
                    placeholder="步骤提示(可选)"
                    value={draft.hint}
                    onChange={(e) => setDraft({ ...draft, hint: e.target.value })}
                  />
                  <div className="flex gap-2 justify-end">
                    <button className="btn-secondary text-xs" onClick={() => setEditing(null)}>取消</button>
                    <button className="btn-primary text-xs" onClick={() => saveStep(step)}>保存</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-medium text-sm">
                        <span className="inline-flex w-6 h-6 rounded-full bg-blue-100 text-blue-700 items-center justify-center text-xs mr-2">
                          {step.step_order}
                        </span>
                        {step.title}
                      </div>
                      <div className="md text-sm text-slate-600 mt-2 whitespace-pre-wrap">
                        {step.content || "(无内容)"}
                      </div>
                      {step.hint && (
                        <div className="text-xs text-amber-600 bg-amber-50 rounded px-2 py-1 mt-2 inline-block">
                          <Lightbulb size={12} className="inline text-amber-500" /> {step.hint}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        className="text-blue-600 hover:underline text-xs"
                        onClick={() => {
                          setEditing(step.id);
                          setDraft({ title: step.title, content: step.content, hint: step.hint ?? "" });
                        }}
                      >
                        编辑
                      </button>
                      <button className="text-red-600 hover:underline text-xs" onClick={() => removeStep(step)}>
                        删除
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ===== 学生步骤进度 ===== */}
      <div className="card p-5 mb-6">
        <h2 className="font-semibold mb-3">学生步骤进度</h2>
        {students.length === 0 ? (
          <p className="text-sm text-slate-400 py-4 text-center">还没有学生加入课程</p>
        ) : steps.length === 0 ? (
          <p className="text-sm text-slate-400 py-4 text-center">请先添加实验步骤</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="text-sm min-w-[600px]">
              <thead>
                <tr className="text-slate-500">
                  <th className="text-left px-3 py-2">学生</th>
                  {steps.map((s) => (
                    <th key={s.id} className="px-3 py-2 whitespace-nowrap">
                      第{s.step_order}步
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {students.map((en) => {
                  const st = en.profiles as CourseEnrollment["profiles"];
                  return (
                    <tr key={en.id} className="border-t border-slate-100">
                      <td className="px-3 py-2 whitespace-nowrap">
                        {st?.full_name}
                        <span className="text-xs text-slate-400 ml-1">{st?.student_no}</span>
                      </td>
                      {steps.map((s) => {
                        const done = progress.some(
                          (p) => p.student_id === en.student_id && p.step_id === s.id && p.completed
                        );
                        return (
                          <td key={s.id} className="px-3 py-2 text-center">
                            {done ? (
                              <span className="text-emerald-600 font-bold">✓</span>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ===== 实验会话 ===== */}
      <div className="card p-5 mb-6">
        <h2 className="font-semibold mb-3">实验会话(最近)</h2>
        {sessions.length === 0 ? (
          <p className="text-sm text-slate-400 py-4 text-center">暂无会话记录</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-slate-500">
              <tr>
                <th className="text-left px-3 py-2">学生</th>
                <th className="text-left px-3 py-2">GPU</th>
                <th className="text-left px-3 py-2">状态</th>
                <th className="text-left px-3 py-2">开始时间</th>
                <th className="text-left px-3 py-2">结束时间</th>
              </tr>
            </thead>
            <tbody>
              {sessions.slice(0, 10).map((s) => (
                <tr key={s.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">{s.profiles?.full_name ?? "-"}</td>
                  <td className="px-3 py-2 text-slate-500 text-xs">{s.gpu_label || "-"}</td>
                  <td className="px-3 py-2">
                    <span className={s.status === "running" ? "badge-green" : "badge-gray"}>
                      {s.status === "running" ? "运行中" : "已结束"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {new Date(s.started_at).toLocaleString("zh-CN")}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {s.stopped_at ? new Date(s.stopped_at).toLocaleString("zh-CN") : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ===== 学生代码提交 ===== */}
      <div className="card p-5 mb-6">
        <h2 className="font-semibold mb-3">代码提交记录(逐行校验结果)</h2>
        {submissions.length === 0 ? (
          <p className="text-sm text-slate-400 py-4 text-center">
            暂无提交{exp.reference_code ? "" : "(该实验未配置参考代码)"}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-slate-500">
              <tr>
                <th className="text-left px-3 py-2">学生</th>
                <th className="text-left px-3 py-2">正确行</th>
                <th className="text-left px-3 py-2">得分</th>
                <th className="text-left px-3 py-2">逐行结果</th>
                <th className="text-left px-3 py-2">提交时间</th>
              </tr>
            </thead>
            <tbody>
              {submissions.slice(0, 20).map((s) => (
                <tr key={s.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 whitespace-nowrap">
                    {s.profiles?.full_name ?? "-"}
                    <span className="text-xs text-slate-400 ml-1">{s.profiles?.student_no}</span>
                  </td>
                  <td className="px-3 py-2">
                    {s.line_correct}/{s.line_total}
                  </td>
                  <td className="px-3 py-2">
                    <span className={s.score === 100 ? "badge-green" : s.score >= 60 ? "badge-amber" : "badge-red"}>
                      {s.score} 分
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs tracking-tight">
                    {(s.line_results ?? [])
                      .map((r: { correct: boolean }) => (r.correct ? "✓" : "✗"))
                      .join(" ")}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {new Date(s.created_at).toLocaleString("zh-CN")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ===== 实验报告批改 ===== */}
      <div className="card p-5">
        <h2 className="font-semibold mb-3">实验报告</h2>
        {reports.length === 0 ? (
          <p className="text-sm text-slate-400 py-4 text-center">学生尚未提交报告</p>
        ) : (
          <div className="space-y-3">
            {reports.map((r) => (
              <div key={r.id} className="border border-slate-200 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div className="font-medium text-sm">
                    {r.profiles?.full_name ?? "学生"}
                    <span className="text-xs text-slate-400 ml-2">
                      {new Date(r.submitted_at).toLocaleString("zh-CN")}
                    </span>
                  </div>
                  {r.score !== null ? (
                    <span className="badge-green">得分 {r.score}</span>
                  ) : (
                    <span className="badge-amber">待批改</span>
                  )}
                </div>
                <div className="text-sm text-slate-600 mt-2 whitespace-pre-wrap bg-slate-50 rounded p-3">
                  {r.content || "(空)"}
                </div>
                <GradeForm report={r} onGrade={grade} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 添加步骤弹窗 */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <form onSubmit={addStep} className="card p-6 w-full max-w-lg space-y-3 my-8">
            <h2 className="font-bold text-lg">添加步骤(第 {steps.length + 1} 步)</h2>
            <div>
              <label className="label">步骤标题 *</label>
              <input
                className="input"
                required
                placeholder="如:加载鸢尾花数据集"
                value={newStep.title}
                onChange={(e) => setNewStep({ ...newStep, title: e.target.value })}
              />
            </div>
            <div>
              <label className="label">步骤内容(支持 Markdown)</label>
              <textarea
                className="input font-mono"
                rows={6}
                placeholder={"指导学生完成本步骤的说明,例如:\n1. 打开 JupyterLab\n2. 运行 `load_iris()` 加载数据\n3. 观察数据分布"}
                value={newStep.content}
                onChange={(e) => setNewStep({ ...newStep, content: e.target.value })}
              />
            </div>
            <div>
              <label className="label">步骤提示(可选,学生卡住时可查看)</label>
              <input
                className="input"
                value={newStep.hint}
                onChange={(e) => setNewStep({ ...newStep, hint: e.target.value })}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-secondary" onClick={() => setShowAdd(false)}>
                取消
              </button>
              <button type="submit" className="btn-primary">添加</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function GradeForm({
  report,
  onGrade,
}: {
  report: ExperimentReport;
  onGrade: (r: ExperimentReport, score: number, feedback: string) => void;
}) {
  const [score, setScore] = useState(report.score?.toString() ?? "");
  const [feedback, setFeedback] = useState(report.feedback ?? "");

  return (
    <div className="flex gap-2 mt-3 items-center">
      <input
        type="number"
        min={0}
        max={100}
        className="input w-24"
        placeholder="得分"
        value={score}
        onChange={(e) => setScore(e.target.value)}
      />
      <input
        className="input flex-1"
        placeholder="评语"
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
      />
      <button
        className="btn-primary text-xs"
        onClick={() => onGrade(report, Number(score), feedback)}
        disabled={score === ""}
      >
        提交批改
      </button>
    </div>
  );
}

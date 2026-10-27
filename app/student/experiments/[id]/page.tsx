"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Cpu, Keyboard, FileText, Lightbulb, PenLine } from "lucide-react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { parseReferenceCode, verifyStudentCode, type VerifyResult } from "@/lib/codecheck";
import type {
  Experiment,
  ExperimentStep,
  StepProgress,
  ExperimentSession,
  ExperimentReport,
} from "@/types";

export default function StudentExperimentPage() {
  const params = useParams();
  const experimentId = params.id as string;
  const supabase = createClient();

  const [exp, setExp] = useState<Experiment | null>(null);
  const [steps, setSteps] = useState<ExperimentStep[]>([]);
  const [progress, setProgress] = useState<StepProgress[]>([]);
  const [session, setSession] = useState<ExperimentSession | null>(null);
  const [report, setReport] = useState<ExperimentReport | null>(null);
  const [reportText, setReportText] = useState("");
  const [hintOpen, setHintOpen] = useState<Record<string, boolean>>({});
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  // 算力容量(剩余卡数)与倒计时刷新
  const [capacity, setCapacity] = useState<{ used: number; total: number; free: number } | null>(null);
  const [nowTick, setNowTick] = useState(Date.now());
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);

  // 代码实训: 逐行输入(粘贴拦截用逐输入框原生监听, 避免影响正常输入)与校验。
  const lineRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [verifyRes, setVerifyRes] = useState<VerifyResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const refLines = parseReferenceCode(exp?.reference_code ?? "");
  const refLineCount = refLines.length;

  const registerCodeInput = (el: HTMLInputElement | null, index: number) => {
    lineRefs.current[index] = el;
    if (el && !(el as HTMLInputElement & { _pasteBlocked?: boolean })._pasteBlocked) {
      (el as HTMLInputElement & { _pasteBlocked?: boolean })._pasteBlocked = true;
      ["paste", "drop", "dragstart"].forEach((ev) =>
        el.addEventListener(ev, (e) => e.preventDefault())
      );
    }
  };

const load = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const [e, s, p, sess, r] = await Promise.all([
      supabase.from("experiments").select("*").eq("id", experimentId).maybeSingle(),
      supabase
        .from("experiment_steps")
        .select("*")
        .eq("experiment_id", experimentId)
        .order("step_order"),
      supabase
        .from("step_progress")
        .select("*")
        .eq("experiment_id", experimentId)
        .eq("student_id", user!.id),
      supabase
        .from("experiment_sessions")
        .select("*")
        .eq("experiment_id", experimentId)
        .eq("student_id", user!.id)
        .eq("status", "running")
        .maybeSingle(),
      supabase
        .from("experiment_reports")
        .select("*")
        .eq("experiment_id", experimentId)
        .eq("student_id", user!.id)
        .maybeSingle(),
    ]);
    setExp((e.data as Experiment) ?? null);
    setSteps((s.data as ExperimentStep[]) ?? []);
    setProgress((p.data as StepProgress[]) ?? []);
    setSession((sess.data as ExperimentSession) ?? null);
    setReport((r.data as ExperimentReport) ?? null);
    if (r.data) setReportText((r.data as ExperimentReport).content ?? "");
    setLoading(false);
  }, [experimentId, supabase]);

  useEffect(() => {
    load();
  }, [load]);

  // 加载算力容量(剩余卡数), 学生在点开启前就能看到"还有几个位置"
  useEffect(() => {
    let alive = true;
    fetch(`/api/sessions?experiment_id=${experimentId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d?.capacity) setCapacity(d.capacity);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [experimentId, session?.id]);

  // 会话运行中每秒刷新倒计时
  useEffect(() => {
    if (!session) return;
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [session]);

  async function toggleStep(step: ExperimentStep) {
    const existing = progress.find((p) => p.step_id === step.id && p.completed);
    if (existing) {
      await supabase.from("step_progress").delete().eq("id", existing.id);
    } else {
      await supabase.from("step_progress").upsert(
        {
          experiment_id: experimentId,
          step_id: step.id,
          student_id: (await supabase.auth.getUser()).data.user!.id,
          completed: true,
        },
        { onConflict: "experiment_id,step_id,student_id" }
      );
    }
    load();
  }

  async function startSession() {
    setStarting(true);
    setError("");
    setNotice("");
    const r = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ experiment_id: experimentId }),
    });
    const d = await r.json();
    setStarting(false);
    if (!r.ok) {
      if (d.capacity) setCapacity(d.capacity);
      setError(d.error ?? "开启失败");
      return;
    }
    setSession(d.session);
    if (d.gpu_label) setNotice(`已分配 GPU:${d.gpu_label}`);
    load();
  }

  async function stopSession() {
    if (!session) return;
    setStopping(true);
    await fetch("/api/sessions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: session.id }),
    });
    setStopping(false);
    setSession(null);
    setNotice("实验会话已结束,GPU 已释放");
    load();
  }

  async function submitReport(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const userId = (await supabase.auth.getUser()).data.user!.id;
    const { error } = await supabase.from("experiment_reports").upsert(
      {
        experiment_id: experimentId,
        student_id: userId,
        content: reportText,
        submitted_at: new Date().toISOString(),
      },
      { onConflict: "experiment_id,student_id" }
    );
    if (error) setError(error.message);
    else {
      setNotice("报告已提交,等待教师批改");
      load();
    }
  }

  // 运行并验证输出 (Jupyter 内核真实执行)
  const [execRunning, setExecRunning] = useState(false);
  const [execRes, setExecRes] = useState<{ match: boolean; output: string } | null>(null);
  const [execErr, setExecErr] = useState("");

  async function runAndVerify() {
    const lines = refLines.map((_, i) => lineRefs.current[i]?.value ?? "");
    if (!lines.some((l) => l.trim())) return;
    setExecRunning(true);
    setExecErr("");
    setExecRes(null);
    try {
      const r = await fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ experiment_id: experimentId, code: lines.join("\n") }),
      });
      const d = await r.json();
      if (!r.ok) setExecErr(d.error ?? "请求失败");
      else if (!d.executed) setExecErr(d.reason ?? "无法执行");
      else setExecRes({ match: !!d.match, output: d.output ?? "" });
    } catch {
      setExecErr("网络错误,请重试");
    }
    setExecRunning(false);
  }

  async function submitCode() {
    const lines = refLines.map((_, i) => lineRefs.current[i]?.value ?? "");
    setSubmitting(true);
    const res = verifyStudentCode(lines, refLines);
    setVerifyRes(res);
    if (!lines.some((l) => l.trim())) {
      setSubmitting(false);
      return;
    }
    try {
      await supabase.from("code_submissions").insert({
        experiment_id: experimentId,
        student_id: (await supabase.auth.getUser()).data.user!.id,
        code: lines.join("\n"),
        score: res.score,
        line_total: res.total,
        line_correct: res.correct,
        line_results: res.results.map((r) => ({ index: r.index, correct: r.correct })),
      });
    } catch {
      /* 记录失败不影响页面展示 */
    }
    setSubmitting(false);
  }

  function resetCode() {
    lineRefs.current.forEach((el) => {
      if (el) el.value = "";
    });
    setVerifyRes(null);
  }

  // 剩余时长(实验时长到点后由 cron 自动回收)
  const remainSec =
    session && exp
      ? Math.max(
          0,
          Math.floor(
            (new Date(session.started_at).getTime() + exp.duration_minutes * 60000 - nowTick) / 1000
          )
        )
      : null;

  if (loading) return <p className="text-slate-400 text-sm">加载中…</p>;
  if (!exp) return <p className="text-slate-500">实验不存在或未开放。</p>;

  const doneCount = progress.filter((p) => p.completed).length;

  return (
    <div className="max-w-4xl">
      <Link
        href={`/student/courses/${exp.course_id}`}
        className="text-slate-400 hover:text-slate-600 text-sm"
      >
        ← 返回课程
      </Link>
      <h1 className="text-xl font-bold mt-1">{exp.title}</h1>
      <p className="text-sm text-slate-500 mt-0.5">{exp.description}</p>
      <div className="flex gap-2 mt-2 mb-5">
        <span className="badge-green">
          进度 {doneCount}/{steps.length} 步
        </span>
        {exp.gpu_required && <span className="badge-blue">GPU</span>}
        <span className="badge-gray">
          {exp.type === "jupyter" ? "JupyterLab 实验" : "在线训练实验"}
        </span>
        {exp.deadline && (
          <span className="badge-amber">
            截止 {new Date(exp.deadline).toLocaleDateString("zh-CN")}
          </span>
        )}
      </div>

      {error && (
        <p className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2 mb-4">{error}</p>
      )}
      {notice && (
        <p className="text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2 mb-4">
          {notice}
        </p>
      )}

      {/* ===== JupyterLab 会话 ===== */}
      {exp.type === "jupyter" && (
        <div className="card p-5 mb-6">
          <h2 className="font-semibold mb-2 flex items-center gap-2"><Cpu size={17} className="text-blue-600" /> 实验环境(JupyterLab)</h2>
          {session ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                <div className="text-sm text-emerald-800 font-medium">
                  实验会话运行中
                  {session.gpu_label && ` · ${session.gpu_label}`}
                </div>
                {remainSec !== null && (
                  <div
                    className={`text-sm font-mono font-bold ${remainSec < 300 ? "text-red-600" : "text-emerald-700"}`}
                    title="到点后环境会自动回收"
                  >
                    ⏳ 剩余 {formatRemain(remainSec)}
                  </div>
                )}
              </div>
              <p className="text-xs text-emerald-700 mb-3">
                会话开始于 {new Date(session.started_at).toLocaleString("zh-CN")}
                {session.gpu_indexes?.length ? ` · 占用显卡 ${session.gpu_indexes.join(",")}` : ""}。
                完成实验后请点击「结束会话」释放 GPU, 到点时系统也会自动回收。
              </p>
              <div className="flex gap-2">
                {session.jupyter_url ? (
                  <a
                    href={session.jupyter_url}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-success"
                  >
                    进入 JupyterLab
                  </a>
                ) : (
                  <span className="text-sm text-amber-600">
                    平台尚未配置 Jupyter 服务地址,请联系管理员
                  </span>
                )}
                <button className="btn-secondary" onClick={stopSession} disabled={stopping}>
                  {stopping ? "结束中…" : "结束会话并释放 GPU"}
                </button>
              </div>
            </div>
          ) : (
            <div>
              <p className="text-sm text-slate-500 mb-3">
                {exp.gpu_required
                  ? "开启实验会话时,平台会为你分配一张空闲显卡并在其上启动专属 JupyterLab。"
                  : "开启实验会话后即可进入 JupyterLab 环境。"}
              </p>
              {exp.gpu_required && capacity && (
                <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                  <div className="flex items-center justify-between text-xs text-slate-600 mb-1.5">
                    <span>
                      当前算力:{capacity.used}/{capacity.total} 卡占用
                    </span>
                    <span className={capacity.free > 0 ? "text-emerald-600 font-medium" : "text-red-600 font-medium"}>
                      {capacity.free > 0 ? `剩余 ${capacity.free} 个位置` : "已满, 请稍后再试"}
                    </span>
                  </div>
                  <div className="h-1.5 bg-white rounded-full overflow-hidden border border-slate-200">
                    <div
                      className={`h-full transition-all ${capacity.free > 0 ? "bg-gradient-to-r from-blue-500 to-cyan-400" : "bg-red-400"}`}
                      style={{ width: `${capacity.total ? Math.min(100, (capacity.used / capacity.total) * 100) : 0}%` }}
                    />
                  </div>
                </div>
              )}
              <button className="btn-primary" onClick={startSession} disabled={starting}>
                {starting ? "正在分配资源…" : "开启实验会话"}
              </button>
            </div>
          )}
        </div>
      )}

      {exp.type === "quick_train" && (
        <div className="card p-5 mb-6">
          <h2 className="font-semibold mb-2">实验环境(平台内置训练)</h2>
          <p className="text-sm text-slate-500 mb-3">
            本实验使用平台内置的在线训练工作台完成。
          </p>
          <Link href={`/train?experiment=${exp.id}`} className="btn-primary">
            <PenLine size={15} />
            打开在线训练工作台
          </Link>
        </div>
      )}

      {/* ===== 实验步骤 ===== */}
      <div className="card p-5 mb-6">
        <h2 className="font-semibold mb-3">实验步骤</h2>
        {steps.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-4">教师还没有添加步骤</p>
        ) : (
          <div className="space-y-3">
            {steps.map((step) => {
              const done = progress.some((p) => p.step_id === step.id && p.completed);
              return (
                <div
                  key={step.id}
                  className={`border rounded-lg p-4 ${
                    done ? "border-emerald-300 bg-emerald-50/40" : "border-slate-200"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <button
                        onClick={() => toggleStep(step)}
                        className={`mt-0.5 w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs shrink-0 transition-colors ${
                          done
                            ? "bg-emerald-500 border-emerald-500 text-white"
                            : "border-slate-300 text-transparent hover:border-emerald-400"
                        }`}
                        title={done ? "点击取消完成" : "点击标记完成"}
                      >
                        ✓
                      </button>
                      <div>
                        <div className={`font-medium text-sm ${done ? "text-emerald-800" : ""}`}>
                          第 {step.step_order} 步:{step.title}
                        </div>
                        <div className="md text-sm text-slate-600 mt-2 whitespace-pre-wrap">
                          {step.content || "(无内容)"}
                        </div>
                        {step.hint && (
                          <div className="mt-2">
                            <button
                              className="text-xs text-amber-600 hover:underline"
                              onClick={() =>
                                setHintOpen({ ...hintOpen, [step.id]: !hintOpen[step.id] })
                              }
                            >
                              {hintOpen[step.id] ? "收起提示" : "查看提示"}
                            </button>
                            {hintOpen[step.id] && (
                              <div className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1.5 mt-1">
                                {step.hint}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ===== 实验指导书 PDF (新标签页打开, 避免内嵌 iframe 干扰代码输入) ===== */}
      <div className="card p-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold flex items-center gap-2"><FileText size={17} className="text-blue-600" /> 实验指导书(按此引导完成实验)</h2>
          <a
            href={`/api/experiments/${experimentId}/guide?download=1`}
            className="btn-secondary text-xs"
          >
            下载 PDF
          </a>
        </div>
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-6 text-center">
          <FileText className="w-9 h-9 mx-auto text-slate-300 mb-2"/>
          <p className="text-sm text-slate-500 mb-4">
            指导书包含实验名称、实验目标与实验步骤(不含代码)。
            <br />
            请在新标签页中打开查看,对照引导在本页逐行输入代码。
          </p>
          <a
            href={`/api/experiments/${experimentId}/guide`}
            target="_blank"
            rel="noreferrer"
            className="btn-primary"
          >
            打开指导书(新标签页)
          </a>
        </div>
      </div>

      {/* ===== 代码实训: 逐行输入与校验 ===== */}
      {refLineCount > 0 && (
        <div className="card p-5 mb-6">
          <div className="flex items-center justify-between mb-1">
            <h2 className="font-semibold flex items-center gap-2"><Keyboard size={17} className="text-blue-600" /> 代码实训({refLineCount} 行)</h2>
            <button className="btn-secondary text-xs" onClick={resetCode}>
              重新输入
            </button>
          </div>
          <p className="text-xs text-slate-400 mb-3">
            按照指导书与每行提示,手动逐行输入代码(禁止复制粘贴)。输入完成后提交校验,全部通过后在实验环境中运行验证结果。
          </p>

          {verifyRes && (
            <div
              className={`rounded-lg px-4 py-3 mb-4 text-sm ${
                verifyRes.allCorrect
                  ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                  : "bg-amber-50 text-amber-800 border border-amber-200"
              }`}
            >
              {verifyRes.allCorrect ? (
                <>
                  代码校验全部通过(得分 {verifyRes.score})!请开启上方实验会话,在
                  JupyterLab 中运行代码,验证实验结果并完成实验报告。
                </>
              ) : (
                <>
                  ⚠️ 校验完成:正确 {verifyRes.correct}/{verifyRes.total} 行(得分{" "}
                  {verifyRes.score}),标红的行为不正确,请根据行首提示修改后重新提交。
                </>
              )}
            </div>
          )}

          <div className="space-y-3">
            {refLines.map((ref, i) => {
              const r = verifyRes?.results[i];
              return (
                <div key={i}>
                  <div className="flex items-center gap-2 mb-1 text-xs">
                    <span className="badge-blue">第 {i + 1} 行</span>
                    {ref.hint && (
                      <span className="text-amber-600 inline-flex items-center gap-1"><Lightbulb size={12} /> {ref.hint}</span>
                    )}
                    {r && (
                      <span className={r.correct ? "text-emerald-600 font-bold" : "text-red-600 font-bold"}>
                        {r.correct ? "✓ 正确" : "✗ 不正确"}
                      </span>
                    )}
                  </div>
                  <input
                    className={`input font-mono text-sm ${
                      r
                        ? r.correct
                          ? "border-emerald-400 focus:ring-emerald-500"
                          : "border-red-400 focus:ring-red-500"
                        : ""
                    }`}
                    placeholder="在此手动输入本行代码(不可粘贴)"
                    ref={(el) => registerCodeInput(el, i)}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                  />
                </div>
              );
            })}
          </div>

          <button
            className="btn-primary w-full py-2.5 mt-4"
            onClick={submitCode}
            disabled={submitting}
          >
            {submitting ? "校验中…" : "提交代码校验"}
          </button>

          {/* 运行并验证输出(Jupyter 内核真实执行) */}
          {exp.expected_output?.trim() && (
            <div className="mt-5 pt-5 border-t border-slate-100">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold">运行代码并验证输出</h3>
                <button
                  className="btn-success text-xs"
                  onClick={runAndVerify}
                  disabled={execRunning}
                >
                  {execRunning ? "内核执行中(最长 1 分钟)…" : "▶ 运行代码并验证输出"}
                </button>
              </div>
              <p className="text-xs text-slate-400 mb-2">
                平台将把你输入的代码提交到 Jupyter 内核真实运行,运行输出与教师配置的「预期输出」比对。
              </p>
              {execErr && (
                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-2">
                  {execErr}
                </p>
              )}
              {execRes && (
                <div className="space-y-2">
                  <div
                    className={`rounded-lg px-3 py-2 text-sm ${
                      execRes.match
                        ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                        : "bg-red-50 text-red-700 border border-red-200"
                    }`}
                  >
                    {execRes.match
                      ? "运行输出与预期输出一致,实验结果正确!"
                      : "运行输出与预期输出不一致,请检查代码后重试"}
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 mb-1">实际输出:</div>
                    <pre className="bg-slate-900 text-slate-100 rounded-lg p-3 text-xs overflow-x-auto whitespace-pre-wrap">
                      {execRes.output || "(无输出)"}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ===== 实验报告 ===== */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold">实验报告</h2>
          {report?.score != null && (
            <span className="badge-green">教师评分:{report.score}</span>
          )}
        </div>
        {report?.feedback && (
          <p className="text-sm text-slate-600 bg-blue-50 rounded-lg px-3 py-2 mb-3">
            教师评语:{report.feedback}
          </p>
        )}
        <form onSubmit={submitReport}>
          <textarea
            className="input"
            rows={6}
            placeholder="总结你的实验过程、结果与心得…"
            value={reportText}
            onChange={(e) => setReportText(e.target.value)}
          />
          <div className="flex justify-end mt-3">
            <button className="btn-primary" disabled={!reportText.trim()}>
              {report ? "更新提交" : "提交报告"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** 秒 → 剩余时长显示 */
function formatRemain(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s2 = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s2).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s2).padStart(2, "0")}`;
}

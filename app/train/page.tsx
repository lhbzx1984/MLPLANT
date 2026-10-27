"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  ZAxis,
} from "recharts";
import {
  MODEL_SPECS,
  BUILTIN_DATASETS,
  parseCsvDataset,
  trainModel,
  defaultHyperparams,
  type Dataset,
  type TrainResult,
} from "@/lib/ml";
import { Database, BrainCircuit, SlidersHorizontal, BarChart3, Upload, Play, Wand2, FileJson } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const CLUSTER_COLORS = ["#2563eb", "#e11d48", "#059669", "#d97706", "#7c3aed", "#0891b2", "#be185d", "#4d7c0f", "#ea580c", "#0f766e"];

interface InferOutput {
  value: number;
  probabilities?: number[];
  confidence?: number;
}

export default function TrainPage() {
  return (
    <Suspense fallback={<p className="text-slate-400 text-sm">加载中…</p>}>
      <TrainWorkbench />
    </Suspense>
  );
}

function TrainWorkbench() {
  const searchParams = useSearchParams();
  const experimentId = searchParams.get("experiment");

  const [dataset, setDataset] = useState<Dataset>(BUILTIN_DATASETS[0]);
  const [modelKey, setModelKey] = useState("logistic");
  const [hyperparams, setHyperparams] = useState<Record<string, number | string>>({});
  const [trainSplit, setTrainSplit] = useState(0.8);
  const [result, setResult] = useState<TrainResult | null>(null);
  const [training, setTraining] = useState(false);
  const [error, setError] = useState("");
  const [csvName, setCsvName] = useState("");
  const [inferInputs, setInferInputs] = useState<(number | undefined)[]>([]);
  const [inferResult, setInferResult] = useState<InferOutput | null>(null);

  const spec = useMemo(
    () => MODEL_SPECS.find((m) => m.key === modelKey)!,
    [modelKey]
  );

  useEffect(() => {
    setHyperparams(defaultHyperparams(spec));
  }, [spec]);

  // 数据集变化时, 用特征均值填充推理输入
  useEffect(() => {
    const d = dataset.X[0]?.length ?? 0;
    const means = Array.from({ length: d }, (_, j) => {
      const s = dataset.X.reduce((acc, row) => acc + row[j], 0);
      return Number((s / dataset.X.length).toFixed(2));
    });
    setInferInputs(means);
    setInferResult(null);
  }, [dataset]);

  const availableModels = MODEL_SPECS.filter((m) => m.tasks.includes(dataset.task));

  function pickDataset(d: Dataset) {
    setDataset(d);
    setResult(null);
    setError("");
    const ok = MODEL_SPECS.find((m) => m.key === modelKey)?.tasks.includes(d.task);
    if (!ok) {
      const first = MODEL_SPECS.find((m) => m.tasks.includes(d.task));
      if (first) setModelKey(first.key);
    }
  }

  async function handleCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const ds = parseCsvDataset(text, file.name);
      setCsvName(file.name);
      pickDataset(ds);
    } catch (err) {
      setError(err instanceof Error ? err.message : "CSV 解析失败");
    }
  }

  async function handleTrain() {
    setTraining(true);
    setError("");
    setResult(null);
    setInferResult(null);
    await new Promise((r) => setTimeout(r, 30));
    try {
      const res = trainModel(modelKey, hyperparams, dataset, trainSplit);
      setResult(res);
      // 保存训练记录(失败静默)
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getUser();
        if (data.user) {
          await supabase.from("training_records").insert({
            user_id: data.user.id,
            experiment_id: experimentId,
            model_type: modelKey,
            dataset_name: dataset.name,
            hyperparams,
            metrics: Object.fromEntries(res.metrics.map((m) => [m.label, m.value])),
          });
        }
      } catch {
        /* 记录保存失败不影响训练 */
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "训练失败");
    }
    setTraining(false);
  }

  function exportModel() {
    if (!result) return;
    const payload = {
      platform: "ML 智学平台",
      model_type: result.modelKey,
      model_name: result.modelName,
      hyperparams: result.hyperparams,
      dataset: { name: dataset.name, features: dataset.features, task: dataset.task },
      metrics: Object.fromEntries(result.metrics.map((m) => [m.label, m.value])),
      history: result.history,
      detail: result.exportData,
      exported_at: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `model-${result.modelKey}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function formatPredict(v: InferOutput) {
    if (dataset.task === "classification" && dataset.targetNames) {
      return dataset.targetNames[v.value] ?? String(v.value);
    }
    return typeof v.value === "number" ? v.value.toFixed(2) : String(v.value);
  }

  return (
    <div>
      {experimentId && (
        <div className="card p-3 mb-4 flex items-center justify-between bg-blue-50 border-blue-200">
          <span className="text-sm text-blue-700">
            当前正在完成平台实验,训练记录将自动保存
          </span>
          <Link href={`/student/experiments/${experimentId}`} className="text-sm text-blue-600 hover:underline">
            ← 返回实验页面
          </Link>
        </div>
      )}

      <h1 className="tech-title text-2xl font-bold mb-1">在线训练工作台</h1>
      <p className="text-sm text-slate-500 mb-4">
        选择数据集与模型,配置超参数,一键训练并可视化结果(全部在浏览器端完成)
      </p>

      <div className="grid xl:grid-cols-3 gap-4">
        {/* ===== 左: 数据 ===== */}
        <div className="space-y-4">
          <div className="card p-5">
            <h2 className="font-semibold mb-3 flex items-center gap-2"><Database size={17} className="text-blue-600" /> 选择数据集</h2>
            <div className="space-y-2">
              {BUILTIN_DATASETS.map((d) => (
                <button
                  key={d.name}
                  onClick={() => pickDataset(d)}
                  className={`w-full text-left rounded-lg border p-3 transition-colors ${
                    dataset.name === d.name
                      ? "border-blue-500 bg-blue-50"
                      : "border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <div className="text-sm font-medium">{d.name}</div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {d.description} · 任务类型:
                    {d.task === "classification" ? "分类" : d.task === "regression" ? "回归" : "聚类"}
                  </div>
                </button>
              ))}
              <label className="block rounded-lg border border-dashed border-slate-300 p-3 text-center cursor-pointer hover:border-blue-400">
                <span className="text-sm text-slate-500 inline-flex flex-col items-center">
                  <Upload size={18} className="text-blue-500 mb-1" />
                  上传自定义 CSV(表头 + 数据, 最后一列为目标列)
                  {csvName && <b className="block text-emerald-600 mt-1">{csvName}</b>}
                </span>
                <input type="file" accept=".csv" className="hidden" onChange={handleCsv} />
              </label>
            </div>

            <h3 className="text-sm font-medium mt-4 mb-2">数据预览(前 5 行)</h3>
            <div className="overflow-x-auto border rounded-lg">
              <table className="text-xs w-full">
                <thead className="bg-slate-50">
                  <tr>
                    {dataset.features.map((f) => (
                      <th key={f} className="px-2 py-1.5 text-left font-medium text-slate-500">
                        {f}
                      </th>
                    ))}
                    <th className="px-2 py-1.5 text-left font-medium text-blue-600">目标</th>
                  </tr>
                </thead>
                <tbody>
                  {dataset.X.slice(0, 5).map((row, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      {row.map((v, j) => (
                        <td key={j} className="px-2 py-1.5 text-slate-600">{v}</td>
                      ))}
                      <td className="px-2 py-1.5 text-blue-600">
                        {dataset.targetNames
                          ? dataset.targetNames[dataset.y[i]] ?? dataset.y[i]
                          : dataset.y[i]}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* ===== 中: 模型与训练 ===== */}
        <div className="space-y-4">
          <div className="card p-5">
            <h2 className="font-semibold mb-3 flex items-center gap-2"><BrainCircuit size={17} className="text-blue-600" /> 选择模型</h2>
            <div className="grid grid-cols-2 gap-2">
              {availableModels.map((m) => (
                <button
                  key={m.key}
                  onClick={() => setModelKey(m.key)}
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    modelKey === m.key
                      ? "border-blue-500 bg-blue-50"
                      : "border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <div className="text-xl">{m.icon}</div>
                  <div className="text-sm font-medium mt-1">{m.name}</div>
                  <div className="text-xs text-slate-400">{m.desc}</div>
                </button>
              ))}
            </div>
            {availableModels.length === 0 && (
              <p className="text-sm text-amber-600 mt-2">当前数据集没有适配的模型</p>
            )}
          </div>

          <div className="card p-5">
            <h2 className="font-semibold mb-3 flex items-center gap-2"><SlidersHorizontal size={17} className="text-blue-600" /> 配置超参数</h2>
            {spec.hyperparams.map((h) => (
              <div key={h.key} className="mb-3">
                <label className="label">{h.label}</label>
                <input
                  type="number"
                  className="input"
                  min={h.min}
                  max={h.max}
                  step={h.step}
                  value={Number(hyperparams[h.key] ?? h.default)}
                  onChange={(e) =>
                    setHyperparams({ ...hyperparams, [h.key]: Number(e.target.value) })
                  }
                />
              </div>
            ))}
            <div className="mb-3">
              <label className="label">训练集比例:{Math.round(trainSplit * 100)}%</label>
              <input
                type="range"
                min={50}
                max={90}
                value={trainSplit * 100}
                onChange={(e) => setTrainSplit(Number(e.target.value) / 100)}
                className="w-full accent-blue-600"
              />
            </div>
            <button
              className="btn-primary w-full py-2.5"
              onClick={handleTrain}
              disabled={training || availableModels.length === 0}
            >
              {training ? "训练中…" : (<span className="inline-flex items-center gap-1.5"><Play size={15} /> 开始训练</span>)}
            </button>
            {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
          </div>

          {result && dataset.task !== "clustering" && (
            <div className="card p-5">
              <h2 className="font-semibold mb-3 flex items-center gap-2"><Wand2 size={17} className="text-blue-600" /> 推理预测</h2>
              <div className="space-y-2">
                {dataset.features.map((f, j) => (
                  <div key={f} className="flex items-center gap-2">
                    <span className="text-xs text-slate-500 w-24 shrink-0">{f}</span>
                    <input
                      type="number"
                      className="input"
                      step="any"
                      value={inferInputs[j] ?? ""}
                      onChange={(e) => {
                        const next = [...inferInputs];
                        next[j] = e.target.value === "" ? undefined : Number(e.target.value);
                        setInferInputs(next);
                      }}
                    />
                  </div>
                ))}
              </div>
              <button
                className="btn-secondary w-full mt-3"
                onClick={() => {
                  if (inferInputs.some((v) => v === undefined || isNaN(v!))) return;
                  setInferResult(result.predict(inferInputs as number[]));
                }}
              >
                预测
              </button>
              {inferResult && (
                <div className="mt-3 bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <div className="text-sm">
                    预测结果:<b className="text-blue-700">{formatPredict(inferResult)}</b>
                  </div>
                  {inferResult.confidence !== undefined && (
                    <div className="text-xs text-slate-500 mt-1">
                      置信度:{(inferResult.confidence * 100).toFixed(1)}%
                    </div>
                  )}
                  {inferResult.probabilities && (
                    <div className="mt-2 space-y-1">
                      {inferResult.probabilities.map((p, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className="text-xs text-slate-500 w-20 truncate">
                            {dataset.targetNames?.[i] ?? `类别${i}`}
                          </span>
                          <div className="flex-1 h-2 bg-white rounded overflow-hidden">
                            <div className="h-full bg-blue-500" style={{ width: `${p * 100}%` }} />
                          </div>
                          <span className="text-xs w-10 text-right">{(p * 100).toFixed(0)}%</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ===== 右: 结果 ===== */}
        <div className="space-y-4">
          {!result ? (
            <div className="card p-10 text-center text-slate-400">
              <BarChart3 className="w-10 h-10 mx-auto text-slate-300 mb-3"/>
              训练结果将在这里展示
            </div>
          ) : (
            <>
              <div className="card p-5">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-semibold flex items-center gap-2"><BarChart3 size={17} className="text-blue-600" /> {result.modelName} · 训练结果</h2>
                  <button className="btn-secondary text-xs inline-flex items-center gap-1" onClick={exportModel}>
                    <FileJson size={13} />
                    导出模型(JSON)
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {result.metrics.map((m) => (
                    <div key={m.label} className="bg-slate-50 rounded-lg p-3">
                      <div className="text-lg font-bold text-slate-800">{m.value}</div>
                      <div className="text-xs text-slate-400 mt-0.5">{m.label}</div>
                    </div>
                  ))}
                </div>
              </div>

              {result.history.length > 1 && (
                <div className="card p-5">
                  <h2 className="font-semibold mb-3">训练过程曲线</h2>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={result.history}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="epoch" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} domain={["auto", "auto"]} />
                      <Tooltip />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="loss"
                        name="损失 Loss"
                        stroke="#2563eb"
                        dot={false}
                        strokeWidth={2}
                      />
                      {result.history.some((h) => h.acc !== undefined) && (
                        <Line
                          type="monotone"
                          dataKey="acc"
                          name="准确率"
                          stroke="#059669"
                          dot={false}
                          strokeWidth={2}
                        />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {result.confusion && (
                <div className="card p-5">
                  <h2 className="font-semibold mb-3">混淆矩阵(测试集)</h2>
                  <div className="overflow-x-auto">
                    <table className="text-xs border-collapse">
                      <thead>
                        <tr>
                          <th className="p-1.5"></th>
                          {result.confusion.labels.map((l, i) => (
                            <th key={i} className="p-1.5 text-slate-500 font-medium">
                              预测 {l}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {result.confusion.matrix.map((row, i) => (
                          <tr key={i}>
                            <th className="p-1.5 text-slate-500 font-medium whitespace-nowrap">
                              实际 {result.confusion!.labels[i]}
                            </th>
                            {row.map((v, j) => (
                              <td
                                key={j}
                                className={`p-1.5 text-center border ${
                                  i === j
                                    ? "bg-emerald-100 text-emerald-800 border-emerald-200 font-bold"
                                    : v > 0
                                      ? "bg-red-50 text-red-700 border-slate-200"
                                      : "text-slate-300 border-slate-100"
                                }`}
                              >
                                {v}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {result.predVsActual && (
                <div className="card p-5">
                  <h2 className="font-semibold mb-3">预测值 vs 实际值(测试集)</h2>
                  <ResponsiveContainer width="100%" height={220}>
                    <ScatterChart>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="actual" name="实际值" tick={{ fontSize: 11 }} type="number" domain={["auto", "auto"]} />
                      <YAxis dataKey="predicted" name="预测值" tick={{ fontSize: 11 }} type="number" domain={["auto", "auto"]} />
                      <ZAxis range={[45, 45]} />
                      <Tooltip />
                      <Scatter data={result.predVsActual} fill="#2563eb" />
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              )}

              {result.clusterPlot && (
                <div className="card p-5">
                  <h2 className="font-semibold mb-3">聚类结果</h2>
                  <ResponsiveContainer width="100%" height={220}>
                    <ScatterChart>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="x" tick={{ fontSize: 11 }} type="number" domain={["auto", "auto"]} />
                      <YAxis dataKey="y" tick={{ fontSize: 11 }} type="number" domain={["auto", "auto"]} />
                      <ZAxis range={[45, 45]} />
                      <Tooltip />
                      {[...new Set(result.clusterPlot.map((p) => p.cluster))].map((c) => (
                        <Scatter
                          key={c}
                          name={`簇 ${c}`}
                          data={result.clusterPlot!.filter((p) => p.cluster === c)}
                          fill={CLUSTER_COLORS[c % CLUSTER_COLORS.length]}
                        />
                      ))}
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

import { BUILTIN_DATASETS, trainModel } from "../lib/ml";

const iris = BUILTIN_DATASETS[0]; // classification
const cls = BUILTIN_DATASETS[1];
const reg = BUILTIN_DATASETS[2];
const clu = BUILTIN_DATASETS[3];

for (const [name, ds, split] of [
  ["logistic@iris", iris, 0.8],
  ["tree@iris", iris, 0.8],
  ["forest@iris", iris, 0.8],
  ["svm@iris", iris, 0.8],
  ["knn@iris", iris, 0.8],
  ["logistic@synth3", cls, 0.8],
  ["linear@reg", reg, 0.8],
  ["knn@reg", reg, 0.8],
  ["kmeans@clu", clu, 0.8],
] as [string, typeof iris, number][]) {
  const key = name.split("@")[0];
  const hp: Record<string, number | string> =
    key === "knn" ? { k: 5 } : key === "tree" ? { max_depth: 5, min_samples_split: 4 }
    : key === "forest" ? { n_estimators: 20, max_depth: 6 }
    : key === "kmeans" ? { k: 3, iterations: 50 } : { epochs: 200 };
  const t0 = Date.now();
  const r = trainModel(key, hp, ds, split);
  const acc = r.metrics.find((m) => m.label.includes("准确率"))?.value
    ?? r.metrics.find((m) => m.label.includes("R²"))?.value ?? "-";
  const inertia = r.metrics.find((m) => m.label.includes("Inertia"))?.value ?? "";
  console.log(`${name.padEnd(16)} acc/metric=${String(acc).padStart(8)} ${inertia} (${Date.now() - t0}ms)`);
}
// 推理冒烟测试
const m = trainModel("logistic", { epochs: 300 }, iris, 0.8);
console.log("predict [5.1,3.5,1.4,0.2] ->", m.predict([5.1, 3.5, 1.4, 0.2]));
console.log("predict [6.9,3.1,5.4,2.1] ->", m.predict([6.9, 3.1, 5.4, 2.1]));

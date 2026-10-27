import type { Dataset, ModelSpec, TrainResult } from "./types";
import {
  trainLinear,
  trainLogistic,
  trainTree,
  trainForest,
  trainSvm,
  trainKnn,
  trainKmeans,
} from "./models";

export type { Dataset, ModelSpec, TrainResult } from "./types";
export { BUILTIN_DATASETS, parseCsvDataset, mulberry32 } from "./datasets";

/** 模型清单 —— 与原「机器学习模型训练平台」对齐 */
export const MODEL_SPECS: ModelSpec[] = [
  {
    key: "linear",
    name: "线性回归",
    icon: "📈",
    tasks: ["regression"],
    desc: "用于连续值预测",
    hyperparams: [
      { key: "epochs", label: "迭代轮数", type: "number", default: 200, min: 50, max: 2000, step: 50 },
    ],
  },
  {
    key: "logistic",
    name: "逻辑回归",
    icon: "📉",
    tasks: ["classification"],
    desc: "二分类 / 多分类",
    hyperparams: [
      { key: "epochs", label: "迭代轮数", type: "number", default: 300, min: 50, max: 2000, step: 50 },
    ],
  },
  {
    key: "tree",
    name: "决策树",
    icon: "🌳",
    tasks: ["classification"],
    desc: "可解释性强的分类模型",
    hyperparams: [
      { key: "max_depth", label: "最大深度", type: "number", default: 5, min: 1, max: 20, step: 1 },
      { key: "min_samples_split", label: "最小分裂样本数", type: "number", default: 4, min: 2, max: 50, step: 1 },
    ],
  },
  {
    key: "forest",
    name: "随机森林",
    icon: "🌲",
    tasks: ["classification"],
    desc: "集成学习方法",
    hyperparams: [
      { key: "n_estimators", label: "树的数量", type: "number", default: 20, min: 5, max: 100, step: 5 },
      { key: "max_depth", label: "最大深度", type: "number", default: 6, min: 1, max: 20, step: 1 },
    ],
  },
  {
    key: "svm",
    name: "支持向量机",
    icon: "🎯",
    tasks: ["classification"],
    desc: "线性核, hinge loss 优化",
    hyperparams: [
      { key: "epochs", label: "迭代轮数", type: "number", default: 200, min: 50, max: 2000, step: 50 },
    ],
  },
  {
    key: "knn",
    name: "K 近邻",
    icon: "🔍",
    tasks: ["classification", "regression"],
    desc: "基于实例的学习",
    hyperparams: [
      { key: "k", label: "邻居数 K", type: "number", default: 5, min: 1, max: 30, step: 1 },
    ],
  },
  {
    key: "kmeans",
    name: "K-Means 聚类",
    icon: "🧲",
    tasks: ["clustering"],
    desc: "无监督聚类",
    hyperparams: [
      { key: "k", label: "簇数 K", type: "number", default: 3, min: 2, max: 10, step: 1 },
      { key: "iterations", label: "迭代次数", type: "number", default: 50, min: 5, max: 300, step: 5 },
    ],
  },
];

const TRAINERS: Record<string, (ds: Dataset, hp: Record<string, number>, split: number) => TrainResult> = {
  linear: trainLinear,
  logistic: trainLogistic,
  tree: trainTree,
  forest: trainForest,
  svm: trainSvm,
  knn: trainKnn,
  kmeans: trainKmeans,
};

export function trainModel(
  modelKey: string,
  hyperparams: Record<string, number | string>,
  dataset: Dataset,
  trainSplit: number
): TrainResult {
  const trainer = TRAINERS[modelKey];
  if (!trainer) throw new Error(`未知模型: ${modelKey}`);
  const hp: Record<string, number> = {};
  for (const [k, v] of Object.entries(hyperparams)) hp[k] = Number(v);
  return trainer(dataset, hp, trainSplit);
}

export function defaultHyperparams(spec: ModelSpec): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const h of spec.hyperparams) out[h.key] = h.default;
  return out;
}

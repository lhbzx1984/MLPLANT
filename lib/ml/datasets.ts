/**
 * 内置数据集(与原「机器学习模型训练平台」保持一致的功能):
 * - 鸢尾花(真实数据, 分类)
 * - 合成回归 / 合成分类 / 合成聚类(种子随机, 可复现)
 * - 自定义 CSV 上传解析
 */
import type { Dataset } from "./types";

const SEED = 20240601;

/** mulberry32 可复现随机数 */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rnd: () => number) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rnd();
  while (v === 0) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---------- 鸢尾花(真实数据集, 150 条) ----------
const IRIS_RAW: [number, number, number, number, number][] = [
  [5.1, 3.5, 1.4, 0.2, 0], [4.9, 3.0, 1.4, 0.2, 0], [4.7, 3.2, 1.3, 0.2, 0],
  [4.6, 3.1, 1.5, 0.2, 0], [5.0, 3.6, 1.4, 0.2, 0], [5.4, 3.9, 1.7, 0.4, 0],
  [4.6, 3.4, 1.4, 0.3, 0], [5.0, 3.4, 1.5, 0.2, 0], [4.4, 2.9, 1.4, 0.2, 0],
  [4.9, 3.1, 1.5, 0.1, 0], [5.4, 3.7, 1.5, 0.2, 0], [4.8, 3.4, 1.6, 0.2, 0],
  [4.8, 3.0, 1.4, 0.1, 0], [4.3, 3.0, 1.1, 0.1, 0], [5.8, 4.0, 1.2, 0.2, 0],
  [5.7, 4.4, 1.5, 0.4, 0], [5.4, 3.9, 1.3, 0.4, 0], [5.1, 3.5, 1.4, 0.3, 0],
  [5.7, 3.8, 1.7, 0.3, 0], [5.1, 3.8, 1.5, 0.3, 0], [5.4, 3.4, 1.7, 0.2, 0],
  [5.1, 3.7, 1.5, 0.4, 0], [4.6, 3.6, 1.0, 0.2, 0], [5.1, 3.3, 1.7, 0.5, 0],
  [4.8, 3.4, 1.9, 0.2, 0], [5.0, 3.0, 1.6, 0.2, 0], [5.0, 3.4, 1.6, 0.4, 0],
  [5.2, 3.5, 1.5, 0.2, 0], [5.2, 3.4, 1.4, 0.2, 0], [4.7, 3.2, 1.6, 0.2, 0],
  [4.8, 3.1, 1.6, 0.2, 0], [5.4, 3.4, 1.5, 0.4, 0], [5.2, 4.1, 1.5, 0.1, 0],
  [5.5, 4.2, 1.4, 0.2, 0], [4.9, 3.1, 1.5, 0.2, 0], [5.0, 3.2, 1.2, 0.2, 0],
  [5.5, 3.5, 1.3, 0.2, 0], [4.9, 3.6, 1.4, 0.1, 0], [4.4, 3.0, 1.3, 0.2, 0],
  [5.1, 3.4, 1.5, 0.2, 0], [5.0, 3.5, 1.3, 0.3, 0], [4.5, 2.3, 1.3, 0.3, 0],
  [4.4, 3.2, 1.3, 0.2, 0], [5.0, 3.5, 1.6, 0.6, 0], [5.1, 3.8, 1.9, 0.4, 0],
  [4.8, 3.0, 1.4, 0.3, 0], [5.1, 3.8, 1.6, 0.2, 0], [4.6, 3.2, 1.4, 0.2, 0],
  [5.3, 3.7, 1.5, 0.2, 0], [5.0, 3.3, 1.4, 0.2, 0],
  [7.0, 3.2, 4.7, 1.4, 1], [6.4, 3.2, 4.5, 1.5, 1], [6.9, 3.1, 4.9, 1.5, 1],
  [5.5, 2.3, 4.0, 1.3, 1], [6.5, 2.8, 4.6, 1.5, 1], [5.7, 2.8, 4.5, 1.3, 1],
  [6.3, 3.3, 4.7, 1.6, 1], [4.9, 2.4, 3.3, 1.0, 1], [6.6, 2.9, 4.6, 1.3, 1],
  [5.2, 2.7, 3.9, 1.4, 1], [5.0, 2.0, 3.5, 1.0, 1], [5.9, 3.0, 4.2, 1.5, 1],
  [6.0, 2.2, 4.0, 1.0, 1], [6.1, 2.9, 4.7, 1.4, 1], [5.6, 2.9, 3.6, 1.3, 1],
  [6.7, 3.1, 4.4, 1.4, 1], [5.6, 3.0, 4.5, 1.5, 1], [5.8, 2.7, 4.1, 1.0, 1],
  [6.2, 2.2, 4.5, 1.5, 1], [5.6, 2.5, 3.9, 1.1, 1], [5.9, 3.2, 4.8, 1.8, 1],
  [6.1, 2.8, 4.0, 1.3, 1], [6.3, 2.5, 4.9, 1.5, 1], [6.1, 2.8, 4.7, 1.2, 1],
  [6.4, 2.9, 4.3, 1.3, 1], [6.6, 3.0, 4.4, 1.4, 1], [6.8, 2.8, 4.8, 1.4, 1],
  [6.7, 3.0, 5.0, 1.7, 1], [6.0, 2.9, 4.5, 1.5, 1], [5.7, 2.6, 3.5, 1.0, 1],
  [5.5, 2.4, 3.8, 1.1, 1], [5.5, 2.4, 3.7, 1.0, 1], [5.8, 2.7, 3.9, 1.2, 1],
  [6.0, 2.7, 5.1, 1.6, 1], [5.4, 3.0, 4.5, 1.5, 1], [6.0, 3.4, 4.5, 1.6, 1],
  [6.7, 3.1, 4.7, 1.5, 1], [6.3, 2.3, 4.4, 1.3, 1], [5.6, 3.0, 4.1, 1.3, 1],
  [5.5, 2.5, 4.0, 1.3, 1], [5.5, 2.6, 4.4, 1.2, 1], [6.1, 3.0, 4.6, 1.4, 1],
  [5.8, 2.6, 4.0, 1.2, 1], [5.0, 2.3, 3.3, 1.0, 1], [5.6, 2.7, 4.2, 1.3, 1],
  [5.7, 3.0, 4.2, 1.2, 1], [5.7, 2.9, 4.2, 1.3, 1], [6.2, 2.9, 4.3, 1.3, 1],
  [5.1, 2.5, 3.0, 1.1, 1], [5.7, 2.8, 4.1, 1.3, 1],
  [6.3, 3.3, 6.0, 2.5, 2], [5.8, 2.7, 5.1, 1.9, 2], [7.1, 3.0, 5.9, 2.1, 2],
  [6.3, 2.9, 5.6, 1.8, 2], [6.5, 3.0, 5.8, 2.2, 2], [7.6, 3.0, 6.6, 2.1, 2],
  [4.9, 2.5, 4.5, 1.7, 2], [7.3, 2.9, 6.3, 1.8, 2], [6.7, 2.5, 5.8, 1.8, 2],
  [7.2, 3.6, 6.1, 2.5, 2], [6.5, 3.2, 5.1, 2.0, 2], [6.4, 2.7, 5.3, 1.9, 2],
  [6.8, 3.0, 5.5, 2.1, 2], [5.7, 2.5, 5.0, 2.0, 2], [5.8, 2.8, 5.1, 2.4, 2],
  [6.4, 3.2, 5.3, 2.3, 2], [6.5, 3.0, 5.5, 1.8, 2], [7.7, 3.8, 6.7, 2.2, 2],
  [7.7, 2.6, 6.9, 2.3, 2], [6.0, 2.2, 5.0, 1.5, 2], [6.9, 3.2, 5.7, 2.3, 2],
  [5.6, 2.8, 4.9, 2.0, 2], [7.7, 2.8, 6.7, 2.0, 2], [6.3, 2.7, 4.9, 1.8, 2],
  [6.7, 3.3, 5.7, 2.1, 2], [7.2, 3.2, 6.0, 1.8, 2], [6.2, 2.8, 4.8, 1.8, 2],
  [6.1, 3.0, 4.9, 1.8, 2], [6.4, 2.8, 5.6, 2.1, 2], [7.2, 3.0, 5.8, 1.6, 2],
  [7.4, 2.8, 6.1, 1.9, 2], [7.9, 3.8, 6.4, 2.0, 2], [6.4, 2.8, 5.6, 2.2, 2],
  [6.3, 2.8, 5.1, 1.5, 2], [6.1, 2.6, 5.6, 1.4, 2], [7.7, 3.0, 6.1, 2.3, 2],
  [6.3, 3.4, 5.6, 2.4, 2], [6.4, 3.1, 5.5, 1.8, 2], [6.0, 3.0, 4.8, 1.8, 2],
  [6.9, 3.1, 5.4, 2.1, 2], [6.7, 3.1, 5.6, 2.4, 2], [6.9, 3.1, 5.1, 2.3, 2],
  [5.8, 2.7, 5.1, 1.9, 2], [6.8, 3.2, 5.9, 2.3, 2], [6.7, 3.3, 5.7, 2.5, 2],
  [6.7, 3.0, 5.2, 2.3, 2], [6.3, 2.5, 5.0, 1.9, 2], [6.5, 3.0, 5.2, 2.0, 2],
  [6.2, 3.4, 5.4, 2.3, 2], [5.9, 3.0, 5.1, 1.8, 2],
];

function buildIris(): Dataset {
  return {
    name: "鸢尾花",
    task: "classification",
    features: ["花萼长度", "花萼宽度", "花瓣长度", "花瓣宽度"],
    X: IRIS_RAW.map((r) => [r[0], r[1], r[2], r[3]]),
    y: IRIS_RAW.map((r) => r[4]),
    targetNames: ["山鸢尾", "变色鸢尾", "维吉尼亚鸢尾"],
    description: "经典多分类数据集,150 条样本,4 个特征,3 个类别",
  };
}

function buildSynthRegression(): Dataset {
  const rnd = mulberry32(SEED);
  const n = 300;
  const X: number[][] = [];
  const y: number[] = [];
  for (let i = 0; i < n; i++) {
    const area = 30 + rnd() * 120; // 房屋面积
    const rooms = 1 + Math.floor(rnd() * 5); // 房间数
    const age = rnd() * 30; // 房龄
    const price =
      12 * area + 28 * rooms - 8 * age + 80 + gaussian(rnd) * 120;
    X.push([area, rooms, age]);
    y.push(price);
  }
  return {
    name: "房价预测(合成)",
    task: "regression",
    features: ["面积(㎡)", "房间数", "房龄(年)"],
    X,
    y,
    description: "模拟房价数据,300 条样本,3 个特征,连续值预测",
  };
}

function buildSynthClassification(): Dataset {
  const rnd = mulberry32(SEED + 1);
  const centers = [
    [2, 6],
    [6, 2],
    [8, 8],
  ];
  const X: number[][] = [];
  const y: number[] = [];
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < 80; i++) {
      X.push([
        centers[c][0] + gaussian(rnd) * 1.4,
        centers[c][1] + gaussian(rnd) * 1.4,
      ]);
      y.push(c);
    }
  }
  // 洗牌
  for (let i = X.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [X[i], X[j]] = [X[j], X[i]];
    [y[i], y[j]] = [y[j], y[i]];
  }
  return {
    name: "三类样本(合成)",
    task: "classification",
    features: ["特征1", "特征2"],
    X,
    y,
    targetNames: ["类别A", "类别B", "类别C"],
    description: "三维高斯分布合成的三分类数据,240 条样本",
  };
}

function buildSynthClustering(): Dataset {
  const rnd = mulberry32(SEED + 2);
  const centers = [
    [1, 1],
    [5, 6],
    [9, 2],
  ];
  const X: number[][] = [];
  for (const c of centers) {
    for (let i = 0; i < 60; i++) {
      X.push([c[0] + gaussian(rnd) * 1.1, c[1] + gaussian(rnd) * 1.1]);
    }
  }
  return {
    name: "客户分群(合成)",
    task: "clustering",
    features: ["消费频次", "消费金额"],
    X,
    y: X.map(() => 0),
    description: "无标签聚类数据,180 条样本,使用 K-Means 聚类",
  };
}

export const BUILTIN_DATASETS: Dataset[] = [
  buildIris(),
  buildSynthClassification(),
  buildSynthRegression(),
  buildSynthClustering(),
];

/** 解析用户上传的 CSV: 第一行为表头, 最后一列为目标列 */
export function parseCsvDataset(text: string, name: string): Dataset {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) throw new Error("CSV 至少需要表头和一行数据");
  const headers = lines[0].split(",").map((h) => h.trim());
  if (headers.length < 2) throw new Error("CSV 至少需要 2 列(特征 + 目标)");

  const rows: string[][] = lines.slice(1).map((l) => l.split(",").map((c) => c.trim()));
  // 数值列索引
  const numericCols: number[] = [];
  for (let c = 0; c < headers.length - 1; c++) {
    const allNum = rows.every((r) => r[c] !== undefined && r[c] !== "" && !isNaN(Number(r[c])));
    if (allNum) numericCols.push(c);
  }
  const targetCol = headers.length - 1;
  const targetNumeric = rows.every(
    (r) => r[targetCol] !== undefined && r[targetCol] !== "" && !isNaN(Number(r[targetCol]))
  );

  if (numericCols.length === 0) throw new Error("没有找到数值型特征列");

  const labelMap = new Map<string, number>();
  const X: number[][] = [];
  const y: number[] = [];
  for (const r of rows) {
    const feats = numericCols.map((c) => Number(r[c]));
    if (feats.some((v) => isNaN(v))) continue;
    let label: number;
    if (targetNumeric) {
      label = Number(r[targetCol]);
    } else {
      const raw = r[targetCol] ?? "";
      if (!labelMap.has(raw)) labelMap.set(raw, labelMap.size);
      label = labelMap.get(raw)!;
    }
    X.push(feats);
    y.push(label);
  }
  if (X.length === 0) throw new Error("没有解析到有效数据行");

  const task: Dataset["task"] = targetNumeric && new Set(y).size > 12 ? "regression" : "classification";
  return {
    name,
    task,
    features: numericCols.map((c) => headers[c]),
    X,
    y,
    targetNames: targetNumeric ? undefined : [...labelMap.entries()].sort((a, b) => a[1] - b[1]).map(([k]) => k),
    description: `自定义 CSV:${X.length} 条样本,${numericCols.length} 个特征`,
  };
}

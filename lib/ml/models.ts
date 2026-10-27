/**
 * 浏览器端机器学习实现(纯 TypeScript, 无后端依赖):
 * 线性回归 / 逻辑回归(softmax) / 决策树 / 随机森林 / 线性SVM(hinge SGD) / KNN / K-Means
 */
import type { Dataset, EpochPoint, TrainResult } from "./types";
import { mulberry32 } from "./datasets";

// ---------- 通用工具 ----------
function standardize(X: number[][]) {
  const d = X[0].length;
  const mean = new Array(d).fill(0);
  const std = new Array(d).fill(0);
  for (const row of X) for (let j = 0; j < d; j++) mean[j] += row[j] / X.length;
  for (const row of X)
    for (let j = 0; j < d; j++) std[j] += (row[j] - mean[j]) ** 2 / X.length;
  for (let j = 0; j < d; j++) std[j] = Math.sqrt(std[j]) || 1;
  return { mean, std, apply: (x: number[]) => x.map((v, j) => (v - mean[j]) / std[j]) };
}

function splitData(X: number[][], y: number[], trainSplit: number, seed = 42) {
  const idx = X.map((_, i) => i);
  const rnd = mulberry32(seed);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  const nTrain = Math.max(2, Math.floor(idx.length * trainSplit));
  const trainIdx = idx.slice(0, nTrain);
  const testIdx = idx.slice(nTrain);
  return {
    Xtr: trainIdx.map((i) => X[i]),
    ytr: trainIdx.map((i) => y[i]),
    Xte: testIdx.map((i) => X[i]),
    yte: testIdx.map((i) => y[i]),
  };
}

function accuracy(yTrue: number[], yPred: number[]) {
  let c = 0;
  for (let i = 0; i < yTrue.length; i++) if (yTrue[i] === yPred[i]) c++;
  return yTrue.length ? c / yTrue.length : 0;
}

function confusion(yTrue: number[], yPred: number[], k: number) {
  const m = Array.from({ length: k }, () => new Array(k).fill(0));
  for (let i = 0; i < yTrue.length; i++) m[yTrue[i]][yPred[i]]++;
  return m;
}

function mse(yTrue: number[], yPred: number[]) {
  let s = 0;
  for (let i = 0; i < yTrue.length; i++) s += (yTrue[i] - yPred[i]) ** 2;
  return yTrue.length ? s / yTrue.length : 0;
}

function r2(yTrue: number[], yPred: number[]) {
  const mean = yTrue.reduce((a, b) => a + b, 0) / (yTrue.length || 1);
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < yTrue.length; i++) {
    ssRes += (yTrue[i] - yPred[i]) ** 2;
    ssTot += (yTrue[i] - mean) ** 2;
  }
  return ssTot === 0 ? 1 : 1 - ssRes / ssTot;
}

// ---------- 线性回归(梯度下降) ----------
function trainLinear(ds: Dataset, hp: Record<string, number>, split: number): TrainResult {
  const { Xtr, ytr, Xte, yte } = splitData(ds.X, ds.y, split);
  const norm = standardize(Xtr);
  const Xt = Xtr.map(norm.apply);
  const d = Xt[0].length;
  const lr = 0.05;
  const epochs = Math.round(hp.epochs ?? 200);
  let w = new Array(d).fill(0);
  let b = 0;
  const history: EpochPoint[] = [];

  for (let e = 1; e <= epochs; e++) {
    const gradW = new Array(d).fill(0);
    let gradB = 0;
    let loss = 0;
    for (let i = 0; i < Xt.length; i++) {
      const pred = Xt[i].reduce((s, v, j) => s + v * w[j], b);
      const err = pred - ytr[i];
      loss += err ** 2 / Xt.length;
      for (let j = 0; j < d; j++) gradW[j] += (err * Xt[i][j]) / Xt.length;
      gradB += err / Xt.length;
    }
    w = w.map((wj, j) => wj - lr * gradW[j]);
    b -= lr * gradB;
    history.push({ epoch: e, loss });
  }

  const predTest = Xte.map((x) => norm.apply(x).reduce((s, v, j) => s + v * w[j], b));
  const r2v = r2(yte, predTest);
  return {
    modelKey: "linear",
    modelName: "线性回归",
    history,
    metrics: [
      { label: "测试集 MSE", value: mse(yte, predTest).toFixed(2) },
      { label: "测试集 R²", value: r2v.toFixed(4) },
      { label: "训练样本", value: String(Xtr.length) },
      { label: "测试样本", value: String(Xte.length) },
    ],
    predVsActual: yte.map((a, i) => ({ actual: a, predicted: predTest[i] })),
    predict: (x) => ({ value: norm.apply(x).reduce((s, v, j) => s + v * w[j], b) }),
    hyperparams: hp,
    exportData: { weights: w, bias: b, mean: norm.mean, std: norm.std },
  };
}

// ---------- 逻辑回归(softmax 多分类, 梯度下降) ----------
function trainLogistic(ds: Dataset, hp: Record<string, number>, split: number): TrainResult {
  const { Xtr, ytr, Xte, yte } = splitData(ds.X, ds.y, split);
  const norm = standardize(Xtr);
  const Xt = Xtr.map(norm.apply);
  const d = Xt[0].length;
  const classes = [...new Set(ds.y)].sort((a, b) => a - b);
  const k = classes.length;
  const lr = 0.1;
  const epochs = Math.round(hp.epochs ?? 300);
  const w: number[][] = Array.from({ length: k }, () => new Array(d).fill(0));
  const bb = new Array(k).fill(0);
  const history: EpochPoint[] = [];

  for (let e = 1; e <= epochs; e++) {
    const gw = Array.from({ length: k }, () => new Array(d).fill(0));
    const gb = new Array(k).fill(0);
    let loss = 0;
    for (let i = 0; i < Xt.length; i++) {
      const scores = w.map((wk, c) => Xt[i].reduce((s, v, j) => s + v * wk[j], bb[c]));
      const maxS = Math.max(...scores);
      const exps = scores.map((s) => Math.exp(s - maxS));
      const sum = exps.reduce((a, b2) => a + b2, 0);
      const probs = exps.map((s) => s / sum);
      const yi = classes.indexOf(ytr[i]);
      loss -= Math.log(Math.max(probs[yi], 1e-12));
      for (let c = 0; c < k; c++) {
        const g = probs[c] - (c === yi ? 1 : 0);
        for (let j = 0; j < d; j++) gw[c][j] += (g * Xt[i][j]) / Xt.length;
        gb[c] += g / Xt.length;
      }
    }
    loss /= Xt.length;
    for (let c = 0; c < k; c++) {
      w[c] = w[c].map((wj, j) => wj - lr * gw[c][j]);
      bb[c] -= lr * gb[c];
    }
    // 训练集准确率
    let correct = 0;
    for (let i = 0; i < Xt.length; i++) {
      const scores = w.map((wk, c) => Xt[i].reduce((s, v, j) => s + v * wk[j], bb[c]));
      const predC = scores.indexOf(Math.max(...scores));
      if (classes[predC] === ytr[i]) correct++;
    }
    history.push({ epoch: e, loss, acc: correct / Xt.length });
  }

  const predictProbs = (xRaw: number[]) => {
    const x = norm.apply(xRaw);
    const scores = w.map((wk, c) => x.reduce((s, v, j) => s + v * wk[j], bb[c]));
    const maxS = Math.max(...scores);
    const exps = scores.map((s) => Math.exp(s - maxS));
    const sum = exps.reduce((a, b2) => a + b2, 0);
    return exps.map((s) => s / sum);
  };

  const predTest = Xte.map((x) => {
    const probs = predictProbs(x);
    return classes[probs.indexOf(Math.max(...probs))];
  });
  const acc = accuracy(yte, predTest);
  const labels = ds.targetNames ?? classes.map((c) => String(c));
  return {
    modelKey: "logistic",
    modelName: "逻辑回归",
    history,
    metrics: [
      { label: "测试集准确率", value: `${(acc * 100).toFixed(1)}%` },
      { label: "训练样本", value: String(Xtr.length) },
      { label: "测试样本", value: String(Xte.length) },
      { label: "类别数", value: String(k) },
    ],
    confusion: { matrix: confusion(yte, predTest, k), labels },
    predict: (x) => {
      const probs = predictProbs(x);
      const idx = probs.indexOf(Math.max(...probs));
      return { value: classes[idx], probabilities: probs, confidence: probs[idx] };
    },
    hyperparams: hp,
    exportData: { weights: w, biases: bb, classes, mean: norm.mean, std: norm.std },
  };
}

// ---------- 决策树(分类, gini) ----------
interface TreeNode {
  leaf: boolean;
  pred: number;
  feat?: number;
  thresh?: number;
  left?: TreeNode;
  right?: TreeNode;
}

function gini(y: number[]) {
  const counts = new Map<number, number>();
  for (const v of y) counts.set(v, (counts.get(v) ?? 0) + 1);
  let g = 1;
  for (const c of counts.values()) g -= (c / y.length) ** 2;
  return g;
}

function buildTree(
  X: number[][],
  y: number[],
  depth: number,
  maxDepth: number,
  minSplit: number
): TreeNode {
  const majority = () => {
    const counts = new Map<number, number>();
    for (const v of y) counts.set(v, (counts.get(v) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  };
  if (depth >= maxDepth || y.length < minSplit || new Set(y).size === 1) {
    return { leaf: true, pred: majority() };
  }
  let bestGini = Infinity;
  let bestFeat = -1;
  let bestThresh = 0;
  const d = X[0].length;
  for (let f = 0; f < d; f++) {
    const vals = [...new Set(X.map((r) => r[f]))].sort((a, b) => a - b);
    const cand: number[] = [];
    for (let i = 0; i < vals.length - 1; i += Math.max(1, Math.floor(vals.length / 16))) {
      cand.push((vals[i] + vals[i + 1]) / 2);
    }
    for (const t of cand) {
      const yl = y.filter((_, i) => X[i][f] <= t);
      const yr = y.filter((_, i) => X[i][f] > t);
      if (yl.length === 0 || yr.length === 0) continue;
      const g = (yl.length / y.length) * gini(yl) + (yr.length / y.length) * gini(yr);
      if (g < bestGini) {
        bestGini = g;
        bestFeat = f;
        bestThresh = t;
      }
    }
  }
  if (bestFeat === -1) return { leaf: true, pred: majority() };
  const li: number[] = [];
  const ri: number[] = [];
  X.forEach((row, i) => (row[bestFeat] <= bestThresh ? li : ri).push(i));
  return {
    leaf: false,
    pred: majority(),
    feat: bestFeat,
    thresh: bestThresh,
    left: buildTree(li.map((i) => X[i]), li.map((i) => y[i]), depth + 1, maxDepth, minSplit),
    right: buildTree(ri.map((i) => X[i]), ri.map((i) => y[i]), depth + 1, maxDepth, minSplit),
  };
}

function treePredict(node: TreeNode, x: number[]): number {
  let cur = node;
  while (!cur.leaf) cur = x[cur.feat!] <= cur.thresh! ? cur.left! : cur.right!;
  return cur.pred;
}

function trainTree(ds: Dataset, hp: Record<string, number>, split: number): TrainResult {
  const { Xtr, ytr, Xte, yte } = splitData(ds.X, ds.y, split);
  const root = buildTree(Xtr, ytr, 0, Math.round(hp.max_depth ?? 5), Math.round(hp.min_samples_split ?? 4));
  const predTest = Xte.map((x) => treePredict(root, x));
  const classes = [...new Set(ds.y)].sort((a, b) => a - b);
  const acc = accuracy(yte, predTest);
  return {
    modelKey: "tree",
    modelName: "决策树",
    history: [],
    metrics: [
      { label: "测试集准确率", value: `${(acc * 100).toFixed(1)}%` },
      { label: "训练样本", value: String(Xtr.length) },
      { label: "测试样本", value: String(Xte.length) },
      { label: "树深度上限", value: String(Math.round(hp.max_depth ?? 5)) },
    ],
    confusion: { matrix: confusion(yte, predTest, classes.length), labels: ds.targetNames ?? classes.map(String) },
    predict: (x) => ({ value: treePredict(root, x) }),
    hyperparams: hp,
    exportData: { tree: root, classes },
  };
}

// ---------- 随机森林 ----------
function trainForest(ds: Dataset, hp: Record<string, number>, split: number): TrainResult {
  const { Xtr, ytr, Xte, yte } = splitData(ds.X, ds.y, split);
  const nTrees = Math.round(hp.n_estimators ?? 20);
  const maxDepth = Math.round(hp.max_depth ?? 6);
  const rnd = mulberry32(7);
  const d = Xtr[0].length;
  const featSubset = Math.max(1, Math.floor(Math.sqrt(d)));
  const trees: { node: TreeNode; feats: number[] }[] = [];

  for (let t = 0; t < nTrees; t++) {
    const boot: number[] = [];
    for (let i = 0; i < Xtr.length; i++) boot.push(Math.floor(rnd() * Xtr.length));
    const feats = [...Array(d).keys()].sort(() => rnd() - 0.5).slice(0, featSubset);
    const Xb = boot.map((i) => feats.map((f) => Xtr[i][f]));
    const yb = boot.map((i) => ytr[i]);
    trees.push({ node: buildTree(Xb, yb, 0, maxDepth, 2), feats });
  }

  const vote = (x: number[]) => {
    const counts = new Map<number, number>();
    for (const t of trees) {
      const p = treePredict(t.node, t.feats.map((f) => x[f]));
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  };

  const predTest = Xte.map(vote);
  const classes = [...new Set(ds.y)].sort((a, b) => a - b);
  const acc = accuracy(yte, predTest);
  return {
    modelKey: "forest",
    modelName: "随机森林",
    history: [],
    metrics: [
      { label: "测试集准确率", value: `${(acc * 100).toFixed(1)}%` },
      { label: "树数量", value: String(nTrees) },
      { label: "OOB 思想", value: "Bootstrap + 特征子采样" },
      { label: "测试样本", value: String(Xte.length) },
    ],
    confusion: { matrix: confusion(yte, predTest, classes.length), labels: ds.targetNames ?? classes.map(String) },
    predict: (x) => ({ value: vote(x) }),
    hyperparams: hp,
    exportData: { n_trees: nTrees, classes },
  };
}

// ---------- 线性 SVM(hinge loss SGD, one-vs-rest) ----------
function trainSvm(ds: Dataset, hp: Record<string, number>, split: number): TrainResult {
  const { Xtr, ytr, Xte, yte } = splitData(ds.X, ds.y, split);
  const norm = standardize(Xtr);
  const Xt = Xtr.map(norm.apply);
  const d = Xt[0].length;
  const classes = [...new Set(ds.y)].sort((a, b) => a - b);
  const k = classes.length;
  const lr = 0.01;
  const lambda = 0.01;
  const epochs = Math.round(hp.epochs ?? 200);
  const W: number[][] = Array.from({ length: k }, () => new Array(d).fill(0));
  const B = new Array(k).fill(0);
  const history: EpochPoint[] = [];

  for (let e = 1; e <= epochs; e++) {
    let hinge = 0;
    for (let i = 0; i < Xt.length; i++) {
      for (let c = 0; c < k; c++) {
        const yi = classes.indexOf(ytr[i]) === c ? 1 : -1;
        const margin = yi * (Xt[i].reduce((s, v, j) => s + v * W[c][j], B[c]));
        hinge += Math.max(0, 1 - margin) / Xt.length;
        if (margin < 1) {
          for (let j = 0; j < d; j++)
            W[c][j] += lr * (yi * Xt[i][j] - lambda * W[c][j]);
          B[c] += lr * yi;
        } else {
          for (let j = 0; j < d; j++) W[c][j] -= lr * lambda * W[c][j];
        }
      }
    }
    history.push({ epoch: e, loss: hinge });
  }

  const score = (xRaw: number[]) => {
    const x = norm.apply(xRaw);
    return W.map((wc, c) => x.reduce((s, v, j) => s + v * wc[j], B[c]));
  };
  const predTest = Xte.map((x) => classes[score(x).indexOf(Math.max(...score(x)))]);
  const acc = accuracy(yte, predTest);
  return {
    modelKey: "svm",
    modelName: "支持向量机(SVM)",
    history,
    metrics: [
      { label: "测试集准确率", value: `${(acc * 100).toFixed(1)}%` },
      { label: "核函数", value: "线性 (hinge loss SGD)" },
      { label: "正则化 C", value: (1 / lambda).toFixed(0) },
      { label: "测试样本", value: String(Xte.length) },
    ],
    confusion: { matrix: confusion(yte, predTest, k), labels: ds.targetNames ?? classes.map(String) },
    predict: (x) => {
      const scores = score(x);
      const idx = scores.indexOf(Math.max(...scores));
      return { value: classes[idx], confidence: 1 / (1 + Math.exp(-scores[idx])) };
    },
    hyperparams: hp,
    exportData: { weights: W, biases: B, classes, mean: norm.mean, std: norm.std },
  };
}

// ---------- KNN ----------
function trainKnn(ds: Dataset, hp: Record<string, number>, split: number): TrainResult {
  const { Xtr, ytr, Xte, yte } = splitData(ds.X, ds.y, split);
  const norm = standardize(Xtr);
  const Xt = Xtr.map(norm.apply);
  const k = Math.round(hp.k ?? 5);
  const predictOne = (xRaw: number[]) => {
    const x = norm.apply(xRaw);
    const dists = Xt.map((row, i) => ({
      d: Math.sqrt(row.reduce((s, v, j) => s + (v - x[j]) ** 2, 0)),
      y: ytr[i],
    }));
    dists.sort((a, b) => a.d - b.d);
    const top = dists.slice(0, k);
    if (ds.task === "regression") {
      return top.reduce((s, t) => s + t.y, 0) / top.length;
    }
    const counts = new Map<number, number>();
    for (const t of top) counts.set(t.y, (counts.get(t.y) ?? 0) + 1);
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    return best[0];
  };
  const predTest = Xte.map(predictOne);
  if (ds.task === "regression") {
    return {
      modelKey: "knn",
      modelName: "K近邻(KNN)",
      history: [],
      metrics: [
        { label: "测试集 MSE", value: mse(yte, predTest).toFixed(2) },
        { label: "测试集 R²", value: r2(yte, predTest).toFixed(4) },
        { label: "K 值", value: String(k) },
        { label: "训练样本", value: String(Xtr.length) },
      ],
      predVsActual: yte.map((a, i) => ({ actual: a, predicted: predTest[i] })),
      predict: (x) => ({ value: predictOne(x) }),
      hyperparams: hp,
      exportData: { k, n_train: Xtr.length },
    };
  }
  const classes = [...new Set(ds.y)].sort((a, b) => a - b);
  const acc = accuracy(yte, predTest);
  return {
    modelKey: "knn",
    modelName: "K近邻(KNN)",
    history: [],
    metrics: [
      { label: "测试集准确率", value: `${(acc * 100).toFixed(1)}%` },
      { label: "K 值", value: String(k) },
      { label: "训练样本", value: String(Xtr.length) },
      { label: "测试样本", value: String(Xte.length) },
    ],
    confusion: { matrix: confusion(yte, predTest, classes.length), labels: ds.targetNames ?? classes.map(String) },
    predict: (x) => {
      const x2 = norm.apply(x);
      const dists = Xt.map((row, i) => ({
        d: Math.sqrt(row.reduce((s, v, j) => s + (v - x2[j]) ** 2, 0)),
        y: ytr[i],
      }));
      dists.sort((a, b) => a.d - b.d);
      const top = dists.slice(0, k);
      const counts = new Map<number, number>();
      for (const t of top) counts.set(t.y, (counts.get(t.y) ?? 0) + 1);
      const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
      return { value: sorted[0][0], confidence: sorted[0][1] / k };
    },
    hyperparams: hp,
    exportData: { k, n_train: Xtr.length },
  };
}

// ---------- K-Means ----------
function trainKmeans(ds: Dataset, hp: Record<string, number>, _split: number): TrainResult {
  const k = Math.round(hp.k ?? 3);
  const iters = Math.round(hp.iterations ?? 50);
  const rnd = mulberry32(11);
  const X = ds.X;
  const d = X[0].length;
  // k-means++ 初始化
  const centers: number[][] = [X[Math.floor(rnd() * X.length)].slice()];
  while (centers.length < k) {
    const dists = X.map((x) =>
      Math.min(...centers.map((c) => x.reduce((s, v, j) => s + (v - c[j]) ** 2, 0)))
    );
    const sum = dists.reduce((a, b) => a + b, 0);
    let r = rnd() * sum;
    let idx = 0;
    for (let i = 0; i < dists.length; i++) {
      r -= dists[i];
      if (r <= 0) {
        idx = i;
        break;
      }
    }
    centers.push(X[idx].slice());
  }

  let labels = new Array(X.length).fill(0);
  const history: EpochPoint[] = [];
  for (let it = 1; it <= iters; it++) {
    let inertia = 0;
    // 分配
    labels = X.map((x) => {
      let best = 0;
      let bestD = Infinity;
      centers.forEach((c, ci) => {
        const dd = x.reduce((s, v, j) => s + (v - c[j]) ** 2, 0);
        if (dd < bestD) {
          bestD = dd;
          best = ci;
        }
      });
      inertia += bestD;
      return best;
    });
    history.push({ epoch: it, loss: inertia });
    // 更新中心
    for (let c = 0; c < k; c++) {
      const members = X.filter((_, i) => labels[i] === c);
      if (members.length === 0) continue;
      for (let j = 0; j < d; j++) {
        centers[c][j] = members.reduce((s, m) => s + m[j], 0) / members.length;
      }
    }
  }

  const sizes = Array.from({ length: k }, (_, c) => labels.filter((l) => l === c).length);
  const finalInertia = history[history.length - 1]?.loss ?? 0;
  return {
    modelKey: "kmeans",
    modelName: "K-Means 聚类",
    history,
    metrics: [
      { label: "簇内平方和 (Inertia)", value: finalInertia.toFixed(2) },
      { label: "簇数 K", value: String(k) },
      { label: "各簇样本数", value: sizes.join(" / ") },
      { label: "迭代次数", value: String(iters) },
    ],
    clusterPlot:
      d >= 1
        ? X.map((x, i) => ({ x: x[0], y: d > 1 ? x[1] : 0, cluster: labels[i] }))
        : undefined,
    predict: (x) => {
      let best = 0;
      let bestD = Infinity;
      centers.forEach((c, ci) => {
        const dd = x.reduce((s, v, j) => s + (v - c[j]) ** 2, 0);
        if (dd < bestD) {
          bestD = dd;
          best = ci;
        }
      });
      return { value: best, confidence: 1 / (1 + bestD) };
    },
    hyperparams: hp,
    exportData: { centers, k },
  };
}

export { trainLinear, trainLogistic, trainTree, trainForest, trainSvm, trainKnn, trainKmeans };

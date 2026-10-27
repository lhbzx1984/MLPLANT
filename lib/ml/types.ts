export type TaskType = "classification" | "regression" | "clustering";

export interface Dataset {
  name: string;
  task: TaskType;
  features: string[];
  X: number[][];
  y: number[];
  targetNames?: string[];
  description?: string;
}

export interface HyperparamSpec {
  key: string;
  label: string;
  type: "number" | "select";
  default: number | string;
  options?: { value: number | string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
  desc?: string;
}

export interface ModelSpec {
  key: string;
  name: string;
  icon: string;
  tasks: TaskType[];
  desc: string;
  hyperparams: HyperparamSpec[];
}

export interface EpochPoint {
  epoch: number;
  loss: number;
  acc?: number;
}

export interface TrainResult {
  modelKey: string;
  modelName: string;
  history: EpochPoint[];
  metrics: { label: string; value: string }[];
  confusion?: { matrix: number[][]; labels: string[] };
  predVsActual?: { actual: number; predicted: number }[];
  clusterPlot?: { x: number; y: number; cluster: number }[];
  predict: (x: number[]) => { value: number; probabilities?: number[]; confidence?: number };
  hyperparams: Record<string, number | string>;
  exportData: Record<string, unknown>;
}

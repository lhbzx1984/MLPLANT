export type Role = "admin" | "teacher" | "student";

export interface Profile {
  id: string;
  email: string | null;
  full_name: string;
  role: Role;
  student_no: string | null;
  status: "active" | "disabled";
  created_at: string;
}

export interface Course {
  id: string;
  name: string;
  description: string | null;
  teacher_id: string;
  invite_code: string;
  gpu_quota: number;
  status: "active" | "archived";
  created_at: string;
  // 联表字段
  profiles?: { full_name: string; email: string | null } | null;
}

export interface CourseEnrollment {
  id: string;
  course_id: string;
  student_id: string;
  joined_at: string;
  profiles?: { full_name: string; student_no: string | null; email: string | null } | null;
  // 联表字段 (学生端查询 enrollments + courses)
  courses?: Course | null;
}

export interface GpuNode {
  id: string;
  name: string;
  provider: string;
  endpoint: string | null;
  spawner_url: string | null;
  gpu_type: string;
  gpu_count: number;
  gpu_memory: string | null;
  region: string | null;
  status: "online" | "offline" | "maintenance";
  notes: string | null;
  created_at: string;
}

export interface GpuAllocation {
  id: string;
  node_id: string;
  gpu_index: number;
  course_id: string | null;
  experiment_id: string | null;
  allocated_by: string | null;
  session_id: string | null;
  status: "active" | "released";
  allocated_at: string;
  released_at: string | null;
  gpu_nodes?: { name: string; gpu_type: string } | null;
}

export interface Material {
  id: string;
  course_id: string;
  uploader_id: string;
  title: string;
  description: string | null;
  file_path: string;
  file_name: string;
  file_size: number | null;
  file_type: string | null;
  created_at: string;
}

export interface Experiment {
  id: string;
  course_id: string;
  teacher_id: string;
  title: string;
  description: string | null;
  type: "jupyter" | "quick_train";
  starter_code: string | null;
  objectives: string | null;
  reference_code: string | null;
  expected_output: string | null;
  gpu_node_id: string | null;
  gpu_required: boolean;
  gpu_count: number;
  duration_minutes: number;
  status: "draft" | "published" | "closed";
  deadline: string | null;
  created_at: string;
}

export interface ExperimentStep {
  id: string;
  experiment_id: string;
  step_order: number;
  title: string;
  content: string;
  hint: string | null;
  created_at: string;
}

export interface ExperimentSession {
  id: string;
  experiment_id: string;
  student_id: string;
  gpu_allocation_id: string | null;
  gpu_indexes: number[] | null;
  jupyter_url: string | null;
  gpu_label: string | null;
  status: "running" | "stopped" | "error";
  started_at: string;
  stopped_at: string | null;
  profiles?: { full_name: string } | null;
}

export interface StepProgress {
  id: string;
  experiment_id: string;
  step_id: string;
  student_id: string;
  completed: boolean;
  completed_at: string;
  note: string | null;
}

export interface ExperimentReport {
  id: string;
  experiment_id: string;
  student_id: string;
  content: string;
  score: number | null;
  feedback: string | null;
  graded_by: string | null;
  graded_at: string | null;
  submitted_at: string;
  profiles?: { full_name: string } | null;
}

export interface TrainingRecord {
  id: string;
  user_id: string;
  experiment_id: string | null;
  model_type: string;
  dataset_name: string;
  hyperparams: Record<string, unknown>;
  metrics: Record<string, unknown>;
  created_at: string;
}

export interface CodeSubmission {
  id: string;
  experiment_id: string;
  student_id: string;
  code: string;
  score: number;
  line_total: number;
  line_correct: number;
  line_results: { index: number; correct: boolean }[];
  executed: boolean | null;
  output: string | null;
  output_match: boolean | null;
  created_at: string;
  profiles?: { full_name: string; student_no: string | null } | null;
}

#!/usr/bin/env node
/**
 * 一键创建引导式代码实验的演示数据(需先执行 supabase/migration_002_guided_code.sql)
 *
 * 创建: 示例教师 + 示例课程「机器学习入门实践」 + 示例学生(选课)
 *       + 示例实验「实验一:鸢尾花分类」(实验目标 + 参考代码 + 步骤)
 * 全部带 demo- 前缀标记, 可随时删除。
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

try {
  const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of env.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_0-9]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {}

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function ensureUser(email, password, fullName, role, studentNo) {
  // 已存在则复用
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 500 });
  const existing = list.users.find((u) => u.email === email);
  if (existing) {
    console.log(`复用已有账号: ${email}`);
    return existing.id;
  }
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, role, student_no: studentNo ?? "" },
  });
  if (error) throw new Error(`创建 ${email} 失败: ${error.message}`);
  console.log(`已创建账号: ${email} (${role})`);
  return data.user.id;
}

const REFERENCE_CODE = `from sklearn.datasets import load_iris  # 加载鸢尾花数据集
from sklearn.model_selection import train_test_split  # 导入数据集划分工具

X, y = load_iris(return_X_y=True)  # 得到特征 X 与标签 y
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.3, random_state=42)  # 划分训练集与测试集

from sklearn.linear_model import LogisticRegression  # 导入逻辑回归模型

model = LogisticRegression(max_iter=200)  # 创建逻辑回归模型
model.fit(X_train, y_train)  # 用训练集训练模型
acc = model.score(X_test, y_test)  # 在测试集上评估准确率
print("测试集准确率:", acc)  # 打印结果`;

const teacherId = await ensureUser(
  "teacher-demo@ml.edu.cn",
  "teacher123456",
  "示例教师",
  "teacher",
  "T0001"
);
const studentId = await ensureUser(
  "student-demo@ml.edu.cn",
  "student123456",
  "示例学生",
  "student",
  "20240001"
);

// 课程
let { data: course } = await admin
  .from("courses")
  .select("id, invite_code")
  .eq("teacher_id", teacherId)
  .eq("name", "机器学习入门实践(demo)")
  .maybeSingle();
if (!course) {
  const { data: created, error } = await admin
    .from("courses")
    .insert({
      name: "机器学习入门实践(demo)",
      description: "演示课程:引导式代码实验",
      teacher_id: teacherId,
    })
    .select("id, invite_code")
    .single();
  if (error) throw new Error("创建课程失败: " + error.message);
  course = created;
  console.log("已创建课程: 机器学习入门实践(demo)");
}

// 选课
await admin
  .from("course_enrollments")
  .upsert({ course_id: course.id, student_id: studentId });

// 实验
let { data: exp } = await admin
  .from("experiments")
  .select("id")
  .eq("course_id", course.id)
  .eq("title", "实验一:鸢尾花分类(demo)")
  .maybeSingle();
if (!exp) {
  const { data: created, error } = await admin
    .from("experiments")
    .insert({
      course_id: course.id,
      teacher_id: teacherId,
      title: "实验一:鸢尾花分类(demo)",
      description: "使用逻辑回归完成鸢尾花分类任务",
      objectives: `1. 理解分类问题的基本流程:加载数据、划分数据集、训练模型、评估效果;
2. 掌握 scikit-learn 中 load_iris、train_test_split、LogisticRegression 的使用;
3. 学会阅读模型评估结果并解释准确率的含义。`,
      reference_code: REFERENCE_CODE,
      type: "jupyter",
      gpu_required: false,
      status: "published",
    })
    .select("id")
    .single();
  if (error) throw new Error("创建实验失败: " + error.message);
  exp = created;
  console.log("已创建实验: 实验一:鸢尾花分类(demo)");

  const steps = [
    ["阅读指导书", "打开本页「实验指导书」PDF,认真阅读实验名称、实验目标与实验步骤。"],
    ["开启实验环境", "点击「开启实验会话」进入平台实验环境(JupyterLab,如已配置)。"],
    ["逐行输入代码", "在下方「代码实训」区域,按照每行的文字提示,手动逐行输入代码(禁止复制粘贴)。"],
    ["提交代码校验", "输入完成后点击「提交代码校验」,根据逐行 ✓/✗ 结果修正,直至全部通过。"],
    ["运行并验证结果", "在 JupyterLab 中运行通过校验的代码,观察测试集准确率输出,完成实验报告并提交。"],
  ].map(([title, content], i) => ({
    experiment_id: exp.id,
    step_order: i + 1,
    title,
    content,
    hint: "",
  }));
  await admin.from("experiment_steps").insert(steps);
  console.log("已创建实验步骤 x" + steps.length);
}

console.log("\n✅ 演示数据就绪:");
console.log("  教师: teacher-demo@ml.edu.cn / teacher123456");
console.log("  学生: student-demo@ml.edu.cn / student123456");
console.log("  课程邀请码:", course.invite_code);

#!/usr/bin/env node
/**
 * 创建第一个平台管理员账号
 *
 * 用法:
 *   1. 在 .env.local 中配置 SUPABASE_SERVICE_ROLE_KEY 与 NEXT_PUBLIC_SUPABASE_URL
 *   2. 运行: node scripts/create-admin.mjs <邮箱> <密码> [姓名]
 *
 * 示例:
 *   node scripts/create-admin.mjs admin@school.edu.cn admin123456 平台管理员
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

// 读取 .env.local
try {
  const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of env.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_0-9]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {
  /* .env.local 不存在则使用系统环境变量 */
}

const [email, password, fullName] = process.argv.slice(2);
if (!email || !password) {
  console.error("用法: node scripts/create-admin.mjs <邮箱> <密码> [姓名]");
  process.exit(1);
}
if (password.length < 6) {
  console.error("密码至少 6 位");
  process.exit(1);
}
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("请先在 .env.local 中配置 NEXT_PUBLIC_SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const { data, error } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { full_name: fullName ?? "平台管理员", role: "admin" },
});

if (error) {
  console.error("创建失败:", error.message);
  process.exit(1);
}
console.log("✅ 管理员账号创建成功:", email);
console.log("   现在可以登录平台了: http://localhost:3000/login");

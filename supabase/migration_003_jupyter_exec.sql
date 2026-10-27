-- =============================================================
-- 增量迁移 003: Jupyter 内核自动执行验证
-- 在 Supabase SQL Editor 中执行(可重复执行)
-- 新增: experiments.expected_output (教师预期输出)
--       code_submissions.executed / output / output_match (真实运行结果)
-- =============================================================

alter table public.experiments add column if not exists expected_output text default '';

alter table public.code_submissions add column if not exists executed boolean default false;
alter table public.code_submissions add column if not exists output text default '';
alter table public.code_submissions add column if not exists output_match boolean;

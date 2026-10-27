-- =============================================================
-- 增量迁移 002: 引导式代码实验
-- 在 Supabase SQL Editor 中执行(可重复执行)
-- 新增: experiments.objectives / experiments.reference_code
--       code_submissions 表(学生代码提交与验证结果)
-- =============================================================

alter table public.experiments add column if not exists objectives text default '';
alter table public.experiments add column if not exists reference_code text default '';

create table if not exists public.code_submissions (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references public.experiments(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  code text not null default '',
  score int not null default 0,
  line_total int not null default 0,
  line_correct int not null default 0,
  line_results jsonb not null default '[]',
  created_at timestamptz not null default now()
);

alter table public.code_submissions enable row level security;

drop policy if exists "code_sub_select_own" on public.code_submissions;
create policy "code_sub_select_own" on public.code_submissions
  for select using (student_id = auth.uid());

drop policy if exists "code_sub_select_course_teacher" on public.code_submissions;
create policy "code_sub_select_course_teacher" on public.code_submissions
  for select using (
    exists (
      select 1 from public.experiments e
      join public.courses c on c.id = e.course_id
      where e.id = experiment_id and c.teacher_id = auth.uid()
    )
  );

drop policy if exists "code_sub_select_admin" on public.code_submissions;
create policy "code_sub_select_admin" on public.code_submissions
  for select using (public.is_admin());

drop policy if exists "code_sub_insert_own_student" on public.code_submissions;
create policy "code_sub_insert_own_student" on public.code_submissions
  for insert with check (
    public.is_student() and student_id = auth.uid()
    and exists (
      select 1 from public.experiments e
      where e.id = experiment_id and e.status = 'published'
        and public.enrolled_in_course(e.course_id)
    )
  );

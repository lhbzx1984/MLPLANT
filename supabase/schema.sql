-- =============================================================
-- ML 智学平台 Supabase 数据库 Schema
-- 在 Supabase Dashboard -> SQL Editor 中执行本文件
-- 本脚本可重复执行(幂等)
-- =============================================================

-- =============================================================
-- 第一部分: 数据表 (按外键依赖顺序)
-- =============================================================

-- ---------- 用户档案 ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text not null default '',
  role text not null default 'student' check (role in ('admin','teacher','student')),
  student_no text,
  status text not null default 'active' check (status in ('active','disabled')),
  created_at timestamptz not null default now()
);

-- ---------- 云端 GPU 节点 ----------
create table if not exists public.gpu_nodes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  provider text not null default 'custom',
  endpoint text,
  spawner_url text,
  gpu_type text not null default 'GPU',
  gpu_count int not null default 1 check (gpu_count > 0),
  gpu_memory text,
  region text,
  status text not null default 'online' check (status in ('online','offline','maintenance')),
  notes text,
  created_at timestamptz not null default now()
);

-- ---------- 课程 ----------
create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text default '',
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  invite_code text not null unique default upper(substr(md5(random()::text), 1, 8)),
  gpu_quota int not null default 0,
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now()
);

-- ---------- 选课 ----------
create table if not exists public.course_enrollments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  unique (course_id, student_id)
);

-- ---------- 实验 ----------
create table if not exists public.experiments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id),
  title text not null,
  description text default '',
  type text not null default 'jupyter' check (type in ('jupyter','quick_train')),
  starter_code text default '',
  objectives text default '',
  reference_code text default '',
  expected_output text default '',
  gpu_required boolean not null default false,
  gpu_count int not null default 1,
  duration_minutes int not null default 120,
  status text not null default 'published' check (status in ('draft','published','closed')),
  deadline timestamptz,
  created_at timestamptz not null default now()
);

-- ---------- GPU 分配记录 ----------
create table if not exists public.gpu_allocations (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references public.gpu_nodes(id) on delete cascade,
  gpu_index int not null check (gpu_index >= 0),
  course_id uuid references public.courses(id) on delete set null,
  experiment_id uuid references public.experiments(id) on delete set null,
  allocated_by uuid references public.profiles(id),
  session_id uuid,
  status text not null default 'active' check (status in ('active','released')),
  allocated_at timestamptz not null default now(),
  released_at timestamptz
);

-- ---------- 实验步骤 ----------
create table if not exists public.experiment_steps (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references public.experiments(id) on delete cascade,
  step_order int not null,
  title text not null,
  content text not null default '',
  hint text default '',
  created_at timestamptz not null default now(),
  unique (experiment_id, step_order)
);

-- ---------- 实验会话 (JupyterLab) ----------
create table if not exists public.experiment_sessions (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references public.experiments(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  gpu_allocation_id uuid references public.gpu_allocations(id),
  gpu_indexes int[] default '{}',
  jupyter_url text,
  gpu_label text default '',
  status text not null default 'running' check (status in ('running','stopped','error')),
  started_at timestamptz not null default now(),
  stopped_at timestamptz
);

-- ---------- 步骤进度 ----------
create table if not exists public.step_progress (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references public.experiments(id) on delete cascade,
  step_id uuid not null references public.experiment_steps(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  completed boolean not null default true,
  completed_at timestamptz not null default now(),
  note text default '',
  unique (experiment_id, step_id, student_id)
);

-- ---------- 代码提交记录 (引导式代码实训) ----------
create table if not exists public.code_submissions (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references public.experiments(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  code text not null default '',
  score int not null default 0,
  line_total int not null default 0,
  line_correct int not null default 0,
  line_results jsonb not null default '[]',
  executed boolean default false,
  output text default '',
  output_match boolean,
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

-- ---------- 实验报告 ----------
create table if not exists public.experiment_reports (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references public.experiments(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  content text not null default '',
  score int check (score between 0 and 100),
  feedback text default '',
  graded_by uuid references public.profiles(id),
  graded_at timestamptz,
  submitted_at timestamptz not null default now(),
  unique (experiment_id, student_id)
);

-- ---------- 在线训练记录 ----------
create table if not exists public.training_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  experiment_id uuid references public.experiments(id) on delete set null,
  model_type text not null,
  dataset_name text not null,
  hyperparams jsonb not null default '{}',
  metrics jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- =============================================================
-- 第二部分: 权限辅助函数 (security definer, 内部查询不受 RLS 影响)
-- =============================================================

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and status = 'active'
  );
$$;

create or replace function public.is_teacher()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'teacher' and status = 'active'
  );
$$;

create or replace function public.is_student()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'student' and status = 'active'
  );
$$;

create or replace function public.teaches_course(p_course uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.courses
    where id = p_course and teacher_id = auth.uid()
  );
$$;

create or replace function public.enrolled_in_course(p_course uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.course_enrollments e
    join public.courses c on c.id = e.course_id
    where e.course_id = p_course and e.student_id = auth.uid()
  );
$$;

-- =============================================================
-- 第三部分: 启用 RLS 并创建行级安全策略
-- =============================================================

-- ---------- profiles ----------
alter table public.profiles enable row level security;

drop policy if exists "profiles_select_self_or_admin" on public.profiles;
create policy "profiles_select_self_or_admin" on public.profiles
  for select using (id = auth.uid() or public.is_admin());

-- 教师可查看自己课程内学生的档案
drop policy if exists "profiles_select_course_members" on public.profiles;
create policy "profiles_select_course_members" on public.profiles
  for select using (
    public.is_teacher() and exists (
      select 1 from public.course_enrollments e
      join public.courses c on c.id = e.course_id
      where e.student_id = profiles.id and c.teacher_id = auth.uid()
    )
  );

-- 学生可查看自己课程教师的档案
drop policy if exists "profiles_select_course_teachers" on public.profiles;
create policy "profiles_select_course_teachers" on public.profiles
  for select using (
    public.is_student() and exists (
      select 1 from public.course_enrollments e
      join public.courses c on c.id = e.course_id
      where c.teacher_id = profiles.id and e.student_id = auth.uid()
    )
  );

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles
  for update using (id = auth.uid())
  with check (id = auth.uid());
-- 角色/状态字段由下方 guard_profile_role 触发器保护

-- ---------- gpu_nodes ----------
alter table public.gpu_nodes enable row level security;

drop policy if exists "gpu_nodes_select_staff" on public.gpu_nodes;
create policy "gpu_nodes_select_staff" on public.gpu_nodes
  for select using (public.is_admin() or public.is_teacher());

drop policy if exists "gpu_nodes_admin_all" on public.gpu_nodes;
create policy "gpu_nodes_admin_all" on public.gpu_nodes
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------- courses ----------
alter table public.courses enable row level security;

drop policy if exists "courses_select_teacher_own" on public.courses;
create policy "courses_select_teacher_own" on public.courses
  for select using (teacher_id = auth.uid());

drop policy if exists "courses_select_enrolled_student" on public.courses;
create policy "courses_select_enrolled_student" on public.courses
  for select using (public.enrolled_in_course(id));

drop policy if exists "courses_select_admin" on public.courses;
create policy "courses_select_admin" on public.courses
  for select using (public.is_admin());

drop policy if exists "courses_insert_teacher" on public.courses;
create policy "courses_insert_teacher" on public.courses
  for insert with check (public.is_teacher() and teacher_id = auth.uid());

drop policy if exists "courses_update_teacher_own" on public.courses;
create policy "courses_update_teacher_own" on public.courses
  for update using (teacher_id = auth.uid())
  with check (teacher_id = auth.uid() and public.is_teacher());

-- ---------- course_enrollments ----------
alter table public.course_enrollments enable row level security;

drop policy if exists "enrollments_select_own" on public.course_enrollments;
create policy "enrollments_select_own" on public.course_enrollments
  for select using (student_id = auth.uid());

drop policy if exists "enrollments_select_course_teacher" on public.course_enrollments;
create policy "enrollments_select_course_teacher" on public.course_enrollments
  for select using (public.teaches_course(course_id));

drop policy if exists "enrollments_select_admin" on public.course_enrollments;
create policy "enrollments_select_admin" on public.course_enrollments
  for select using (public.is_admin());

drop policy if exists "enrollments_insert_self" on public.course_enrollments;
create policy "enrollments_insert_self" on public.course_enrollments
  for insert with check (public.is_student() and student_id = auth.uid());

drop policy if exists "enrollments_insert_teacher" on public.course_enrollments;
create policy "enrollments_insert_teacher" on public.course_enrollments
  for insert with check (public.teaches_course(course_id) and public.is_teacher());

drop policy if exists "enrollments_delete_own_or_teacher" on public.course_enrollments;
create policy "enrollments_delete_own_or_teacher" on public.course_enrollments
  for delete using (student_id = auth.uid() or public.teaches_course(course_id));

-- ---------- experiments ----------
alter table public.experiments enable row level security;

drop policy if exists "experiments_select_teacher_own" on public.experiments;
create policy "experiments_select_teacher_own" on public.experiments
  for select using (teacher_id = auth.uid());

drop policy if exists "experiments_select_enrolled_student" on public.experiments;
create policy "experiments_select_enrolled_student" on public.experiments
  for select using (
    public.enrolled_in_course(course_id) and status = 'published'
  );

drop policy if exists "experiments_select_admin" on public.experiments;
create policy "experiments_select_admin" on public.experiments
  for select using (public.is_admin());

drop policy if exists "experiments_insert_teacher" on public.experiments;
create policy "experiments_insert_teacher" on public.experiments
  for insert with check (public.teaches_course(course_id) and teacher_id = auth.uid());

drop policy if exists "experiments_update_teacher_own" on public.experiments;
create policy "experiments_update_teacher_own" on public.experiments
  for update using (teacher_id = auth.uid())
  with check (teacher_id = auth.uid() and public.is_teacher());

drop policy if exists "experiments_delete_teacher_own" on public.experiments;
create policy "experiments_delete_teacher_own" on public.experiments
  for delete using (teacher_id = auth.uid());

-- ---------- gpu_allocations ----------
alter table public.gpu_allocations enable row level security;

drop policy if exists "gpu_allocations_select_staff" on public.gpu_allocations;
create policy "gpu_allocations_select_staff" on public.gpu_allocations
  for select using (
    public.is_admin()
    or (public.is_teacher() and exists (
      select 1 from public.courses c
      where c.id = gpu_allocations.course_id and c.teacher_id = auth.uid()
    ))
  );

-- ---------- experiment_steps ----------
alter table public.experiment_steps enable row level security;

drop policy if exists "steps_select_teacher_own" on public.experiment_steps;
create policy "steps_select_teacher_own" on public.experiment_steps
  for select using (
    public.is_teacher() and exists (
      select 1 from public.experiments e
      where e.id = experiment_id and e.teacher_id = auth.uid()
    )
  );

drop policy if exists "steps_select_enrolled_student" on public.experiment_steps;
create policy "steps_select_enrolled_student" on public.experiment_steps
  for select using (
    public.is_student() and exists (
      select 1 from public.experiments e
      where e.id = experiment_id
        and e.status = 'published'
        and public.enrolled_in_course(e.course_id)
    )
  );

drop policy if exists "steps_write_teacher_own" on public.experiment_steps;
create policy "steps_write_teacher_own" on public.experiment_steps
  for all using (
    public.is_teacher() and exists (
      select 1 from public.experiments e
      where e.id = experiment_id and e.teacher_id = auth.uid()
    )
  ) with check (
    public.is_teacher() and exists (
      select 1 from public.experiments e
      where e.id = experiment_id and e.teacher_id = auth.uid()
    )
  );

-- ---------- experiment_sessions ----------
alter table public.experiment_sessions enable row level security;

drop policy if exists "sessions_select_own" on public.experiment_sessions;
create policy "sessions_select_own" on public.experiment_sessions
  for select using (student_id = auth.uid());

drop policy if exists "sessions_select_course_teacher" on public.experiment_sessions;
create policy "sessions_select_course_teacher" on public.experiment_sessions
  for select using (
    exists (
      select 1 from public.experiments e
      join public.courses c on c.id = e.course_id
      where e.id = experiment_id and c.teacher_id = auth.uid()
    )
  );

drop policy if exists "sessions_insert_own_student" on public.experiment_sessions;
create policy "sessions_insert_own_student" on public.experiment_sessions
  for insert with check (
    public.is_student() and student_id = auth.uid()
    and exists (
      select 1 from public.experiments e
      where e.id = experiment_id and e.status = 'published'
        and public.enrolled_in_course(e.course_id)
    )
  );

drop policy if exists "sessions_update_own_student" on public.experiment_sessions;
create policy "sessions_update_own_student" on public.experiment_sessions
  for update using (student_id = auth.uid())
  with check (student_id = auth.uid());

-- ---------- step_progress ----------
alter table public.step_progress enable row level security;

drop policy if exists "progress_select_own" on public.step_progress;
create policy "progress_select_own" on public.step_progress
  for select using (student_id = auth.uid());

drop policy if exists "progress_select_course_teacher" on public.step_progress;
create policy "progress_select_course_teacher" on public.step_progress
  for select using (
    exists (
      select 1 from public.experiments e
      join public.courses c on c.id = e.course_id
      where e.id = experiment_id and c.teacher_id = auth.uid()
    )
  );

drop policy if exists "progress_write_own_student" on public.step_progress;
create policy "progress_write_own_student" on public.step_progress
  for all using (
    public.is_student() and student_id = auth.uid()
    and exists (
      select 1 from public.experiments e
      where e.id = experiment_id and public.enrolled_in_course(e.course_id)
    )
  ) with check (
    public.is_student() and student_id = auth.uid()
    and exists (
      select 1 from public.experiments e
      where e.id = experiment_id and public.enrolled_in_course(e.course_id)
    )
  );

-- ---------- experiment_reports ----------
alter table public.experiment_reports enable row level security;

drop policy if exists "reports_select_own" on public.experiment_reports;
create policy "reports_select_own" on public.experiment_reports
  for select using (student_id = auth.uid());

drop policy if exists "reports_select_course_teacher" on public.experiment_reports;
create policy "reports_select_course_teacher" on public.experiment_reports
  for select using (
    exists (
      select 1 from public.experiments e
      join public.courses c on c.id = e.course_id
      where e.id = experiment_id and c.teacher_id = auth.uid()
    )
  );

drop policy if exists "reports_insert_own_student" on public.experiment_reports;
create policy "reports_insert_own_student" on public.experiment_reports
  for insert with check (
    public.is_student() and student_id = auth.uid()
    and exists (
      select 1 from public.experiments e
      where e.id = experiment_id and public.enrolled_in_course(e.course_id)
    )
  );

drop policy if exists "reports_update_teacher" on public.experiment_reports;
create policy "reports_update_teacher" on public.experiment_reports
  for update using (
    exists (
      select 1 from public.experiments e
      join public.courses c on c.id = e.course_id
      where e.id = experiment_id and c.teacher_id = auth.uid()
    )
  );

-- ---------- training_records ----------
alter table public.training_records enable row level security;

drop policy if exists "records_select_own" on public.training_records;
create policy "records_select_own" on public.training_records
  for select using (user_id = auth.uid());

drop policy if exists "records_select_course_teacher" on public.training_records;
create policy "records_select_course_teacher" on public.training_records
  for select using (
    public.is_teacher() and exists (
      select 1 from public.course_enrollments e
      join public.courses c on c.id = e.course_id
      where e.student_id = user_id and c.teacher_id = auth.uid()
    )
  );

drop policy if exists "records_insert_own" on public.training_records;
create policy "records_insert_own" on public.training_records
  for insert with check (user_id = auth.uid());

-- =============================================================
-- 第四部分: 业务函数 (邀请码加入 / GPU 原子分配与释放)
-- =============================================================

-- 学生通过邀请码加入课程
create or replace function public.join_course(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_course uuid;
  v_role text;
begin
  if auth.uid() is null then
    raise exception '未登录';
  end if;
  select role into v_role from public.profiles where id = auth.uid();
  if v_role <> 'student' then
    raise exception '只有学生可以加入课程';
  end if;
  select id into v_course from public.courses
    where invite_code = upper(trim(p_code)) and status = 'active';
  if v_course is null then
    raise exception '邀请码不存在或课程已归档';
  end if;
  insert into public.course_enrollments (course_id, student_id)
    values (v_course, auth.uid())
    on conflict (course_id, student_id) do nothing;
  return v_course;
end $$;
grant execute on function public.join_course(text) to authenticated;

-- GPU 原子分配: 选择空闲卡数足够的在线节点, 从低到高占用卡号 (行锁防并发)
create or replace function public.allocate_gpu(
  p_course_id uuid,
  p_experiment_id uuid,
  p_allocated_by uuid,
  p_gpu_count int
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_node record;
  v_idx int;
  v_alloc_ids uuid[] := '{}';
  v_new_id uuid;
  v_i int;
begin
  select n.id, n.name, n.gpu_type, n.endpoint, n.gpu_count,
         n.gpu_count - (select count(*) from gpu_allocations a
                        where a.node_id = n.id and a.status = 'active') as free
    into v_node
  from gpu_nodes n
  where n.status = 'online'
    and n.gpu_count - (select count(*) from gpu_allocations a
                       where a.node_id = n.id and a.status = 'active') >= p_gpu_count
  order by free desc
  limit 1;

  if v_node.id is null then
    return jsonb_build_object('ok', false, 'error', 'no_free_gpu');
  end if;

  -- 锁定该节点行, 防止并发分配到同一张卡
  perform 1 from gpu_nodes where id = v_node.id for update;

  for v_i in 1..p_gpu_count loop
    select g into v_idx
    from generate_series(0, v_node.gpu_count - 1) g
    where not exists (
      select 1 from gpu_allocations a
      where a.node_id = v_node.id and a.status = 'active' and a.gpu_index = g
    )
    order by g
    limit 1;

    insert into gpu_allocations (node_id, gpu_index, course_id, experiment_id, allocated_by, status)
    values (v_node.id, v_idx, p_course_id, p_experiment_id, p_allocated_by, 'active')
    returning id into v_new_id;
    v_alloc_ids := v_alloc_ids || v_new_id;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'node_id', v_node.id,
    'node_name', v_node.name,
    'gpu_type', v_node.gpu_type,
    'endpoint', v_node.endpoint,
    'allocation_ids', to_jsonb(v_alloc_ids)
  );
end $$;

-- GPU 释放
create or replace function public.release_gpu(p_allocation_ids uuid[])
returns void language sql security definer set search_path = public as $$
  update gpu_allocations
  set status = 'released', released_at = now()
  where id = any(p_allocation_ids) and status = 'active';
$$;

grant execute on function public.allocate_gpu(uuid, uuid, uuid, int) to authenticated;
grant execute on function public.release_gpu(uuid[]) to authenticated;

-- =============================================================
-- 第五部分: 触发器 (新用户建档 / 防提权)
-- =============================================================

-- 新用户自动建档 (账号由管理员通过 service role 创建)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role, student_no)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'role', 'student'),
    nullif(new.raw_user_meta_data->>'student_no', '')
  );
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 禁止普通用户自助修改角色/状态 (service_role 服务端上下文放行)
create or replace function public.guard_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role <> old.role or new.status <> old.status then
    if auth.uid() is not null then
      if not exists (
        select 1 from public.profiles
        where id = auth.uid() and role = 'admin'
      ) then
        raise exception '无权限修改角色或状态';
      end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists guard_profile_role on public.profiles;
create trigger guard_profile_role
  before update on public.profiles
  for each row execute procedure public.guard_profile_role();

-- =============================================================
-- 第六部分: 存储桶 (教学资料)
-- =============================================================

do $$
begin
  insert into storage.buckets (id, name, public)
  values ('materials', 'materials', false)
  on conflict (id) do nothing;
exception when others then
  raise notice '跳过存储桶创建: %', sqlerrm;
end $$;

drop policy if exists "materials_storage_read" on storage.objects;
create policy "materials_storage_read" on storage.objects
  for select using (
    bucket_id = 'materials'
    and (
      public.is_admin()
      or (public.is_teacher() and public.teaches_course(((storage.foldername(name))[1])::uuid))
      or (public.is_student() and public.enrolled_in_course(((storage.foldername(name))[1])::uuid))
    )
  );

drop policy if exists "materials_storage_write" on storage.objects;
create policy "materials_storage_write" on storage.objects
  for insert with check (
    bucket_id = 'materials'
    and (
      public.is_admin()
      or (public.is_teacher() and public.teaches_course(((storage.foldername(name))[1])::uuid))
    )
  );

drop policy if exists "materials_storage_delete" on storage.objects;
create policy "materials_storage_delete" on storage.objects
  for delete using (
    bucket_id = 'materials'
    and (
      public.is_admin()
      or (public.is_teacher() and public.teaches_course(((storage.foldername(name))[1])::uuid))
    )
  );

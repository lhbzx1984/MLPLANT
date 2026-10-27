-- =============================================================
-- 增量迁移 005: 共享 GPU 机器池(一台机器带一个班)
-- 在 Supabase SQL Editor 中执行(可重复执行, 请先执行 003 / 004)
-- =============================================================

-- 1) 会话记录实际占用的卡号(供 spawner 精确绑定, 也便于审计)
alter table public.experiment_sessions add column if not exists gpu_indexes int[] default '{}';

-- 2) GPU 节点增加「开通服务地址」(部署在本机上的 spawner 服务)
alter table public.gpu_nodes add column if not exists spawner_url text;

-- 3) 加速卡位占用查询与超时会话扫描
create index if not exists idx_gpu_alloc_active
  on public.gpu_allocations (node_id, gpu_index) where status = 'active';
create index if not exists idx_sessions_running
  on public.experiment_sessions (status, started_at);
create index if not exists idx_sessions_student
  on public.experiment_sessions (student_id, status);

-- 4) allocate_gpu 返回实际卡号(供 spawner 用 NVIDIA_VISIBLE_DEVICES 绑定)
create or replace function public.allocate_gpu(
  p_course_id uuid,
  p_experiment_id uuid,
  p_allocated_by uuid,
  p_gpu_count int,
  p_node_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_node record;
  v_idx int;
  v_alloc_ids uuid[] := '{}';
  v_indexes int[] := '{}';
  v_new_id uuid;
  v_i int;
begin
  select n.id, n.name, n.gpu_type, n.endpoint, n.spawner_url, n.gpu_count,
         n.gpu_count - (select count(*) from gpu_allocations a
                        where a.node_id = n.id and a.status = 'active') as free
    into v_node
  from gpu_nodes n
  where n.status = 'online'
    and (p_node_id is null or n.id = p_node_id)
    and n.gpu_count - (select count(*) from gpu_allocations a
                       where a.node_id = n.id and a.status = 'active') >= p_gpu_count
  order by free desc
  limit 1;

  if v_node.id is null then
    return jsonb_build_object('ok', false, 'error', 'no_free_gpu');
  end if;

  -- 行锁: 防止并发分配到同一张卡
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
    v_indexes := v_indexes || v_idx;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'node_id', v_node.id,
    'node_name', v_node.name,
    'gpu_type', v_node.gpu_type,
    'endpoint', v_node.endpoint,
    'spawner_url', v_node.spawner_url,
    'allocation_ids', to_jsonb(v_alloc_ids),
    'gpu_indexes', to_jsonb(v_indexes)
  );
end $$;

-- 5) 节点容量视图(用于"已满"友好提示)
create or replace function public.node_capacity()
returns table (
  node_id uuid,
  node_name text,
  gpu_type text,
  total_cards int,
  used_cards int,
  free_cards int,
  status text
)
language sql security definer set search_path = public as $$
  select n.id,
         n.name,
         n.gpu_type,
         n.gpu_count,
         coalesce(a.used, 0)::int,
         (n.gpu_count - coalesce(a.used, 0))::int,
         n.status
  from gpu_nodes n
  left join (
    select node_id, count(*) as used
    from gpu_allocations
    where status = 'active'
    group by node_id
  ) a on a.node_id = n.id
  order by n.created_at;
$$;

grant execute on function public.node_capacity() to authenticated;

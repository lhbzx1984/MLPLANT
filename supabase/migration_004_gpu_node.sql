-- =============================================================
-- 增量迁移 004: 实验绑定指定 GPU 节点 / Jupyter 内核
-- 在 Supabase SQL Editor 中执行(可重复执行, 请先执行 003)
-- =============================================================

alter table public.experiments add column if not exists gpu_node_id uuid references public.gpu_nodes(id) on delete set null;

-- allocate_gpu 升级: 支持指定节点 (p_node_id 为空 = 自动分配)
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
  v_new_id uuid;
  v_i int;
begin
  select n.id, n.name, n.gpu_type, n.endpoint, n.gpu_count,
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

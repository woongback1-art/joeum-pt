-- =============================================================
-- 식단표 (회원별 주간 식단, 종이 양식과 같은 모양)
--  · days = 7일치 [{wake, breakfast, breakfast_t, snack1, snack1_t, lunch, lunch_t,
--                   snack2, snack2_t, dinner, dinner_t, snack3, snack3_t, sleep}]
--  · 직원은 읽기·쓰기, 삭제는 관리자 또는 작성한 강사
--  · share_token 이 있는 식단표만 링크로 (로그인 없이) 볼 수 있음
-- =============================================================
create table if not exists public.diets (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  trainer_id uuid references public.profiles(id) on delete set null default auth.uid(),
  start_date date not null,
  days jsonb not null default '[]'::jsonb,
  memo text not null default '',
  share_token text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists diets_member_idx on public.diets (member_id, start_date desc);

alter table public.diets enable row level security;
drop policy if exists diets_select on public.diets;
drop policy if exists diets_insert on public.diets;
drop policy if exists diets_update on public.diets;
drop policy if exists diets_delete on public.diets;
create policy diets_select on public.diets for select to authenticated using (public.is_staff());
create policy diets_insert on public.diets for insert to authenticated with check (public.is_staff());
create policy diets_update on public.diets for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy diets_delete on public.diets for delete to authenticated using (public.is_admin() or (public.is_staff() and trainer_id = auth.uid()));
grant select, insert, update, delete on public.diets to authenticated;
revoke all on public.diets from anon;

create or replace function public.get_shared_diet(p_token text)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'member', m.name,
    'trainer', p.name,
    'start_date', d.start_date,
    'days', d.days,
    'memo', d.memo,
    'updated_at', d.updated_at
  )
  from public.diets d
  join public.members m on m.id = d.member_id
  left join public.profiles p on p.id = d.trainer_id
  where p_token is not null and length(p_token) >= 20 and d.share_token = p_token
  limit 1;
$$;
grant execute on function public.get_shared_diet(text) to anon, authenticated;

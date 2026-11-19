-- =========================================================
--  운동 숙제 체크 — joeum-pt(센터 통합 관리)와 같은 Supabase에 추가
--  기존 members / profiles / is_staff() 를 그대로 사용합니다.
--  기존 테이블은 members 에 hw_token 컬럼 하나만 추가됩니다.
-- =========================================================

-- 1) 회원별 숙제 링크 코드 (기존 회원 전원에게 자동 발급)
alter table public.members
  add column if not exists hw_token text not null default replace(gen_random_uuid()::text, '-', '');
create unique index if not exists members_hw_token_key on public.members (hw_token);

-- 2) 숙제 테이블
create table if not exists public.hw_homeworks (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.members on delete cascade,
  title       text not null,
  detail      text not null default '',
  days        int[] not null default '{}',   -- 0=일 … 6=토, 비어 있으면 매일
  sort        int not null default 0,
  active      boolean not null default true,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);

create table if not exists public.hw_logs (
  homework_id uuid not null references public.hw_homeworks on delete cascade,
  member_id   uuid not null references public.members on delete cascade,
  done_date   date not null,
  created_at  timestamptz not null default now(),
  primary key (homework_id, done_date)
);

create table if not exists public.hw_reports (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.members on delete cascade,
  report_date date not null,
  feeling     int check (feeling between 1 and 5),
  comment     text not null default '',
  created_at  timestamptz not null default now(),
  unique (member_id, report_date)
);

create index if not exists hw_homeworks_member on public.hw_homeworks (member_id);
create index if not exists hw_logs_member_date on public.hw_logs (member_id, done_date);
create index if not exists hw_reports_member_date on public.hw_reports (member_id, report_date);

-- 3) 보안: 센터 직원(admin, trainer)만 직접 접근
alter table public.hw_homeworks enable row level security;
alter table public.hw_logs      enable row level security;
alter table public.hw_reports   enable row level security;

drop policy if exists hw_homeworks_staff on public.hw_homeworks;
create policy hw_homeworks_staff on public.hw_homeworks for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists hw_logs_staff on public.hw_logs;
create policy hw_logs_staff on public.hw_logs for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists hw_reports_staff on public.hw_reports;
create policy hw_reports_staff on public.hw_reports for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- 4) 회원용 함수 (로그인 없이 링크 코드로만 동작)
create or replace function public.hw_member_get(p_token text)
returns json language plpgsql security definer set search_path = public as $$
declare m public.members;
begin
  select * into m from public.members where hw_token = p_token;
  if not found then return null; end if;
  return json_build_object(
    'name', m.name,
    'homeworks', coalesce((
      select json_agg(json_build_object('id', h.id, 'title', h.title, 'detail', h.detail,
                                        'days', h.days, 'sort', h.sort, 'created_at', h.created_at)
                      order by h.sort, h.created_at)
      from public.hw_homeworks h where h.member_id = m.id and h.active), '[]'::json),
    'logs', coalesce((
      select json_agg(json_build_object('homework_id', l.homework_id, 'done_date', l.done_date))
      from public.hw_logs l where l.member_id = m.id and l.done_date >= current_date - 60), '[]'::json),
    'reports', coalesce((
      select json_agg(json_build_object('report_date', r.report_date, 'feeling', r.feeling, 'comment', r.comment))
      from public.hw_reports r where r.member_id = m.id and r.report_date >= current_date - 60), '[]'::json)
  );
end $$;

create or replace function public.hw_member_toggle(p_token text, p_homework_id uuid, p_date date, p_done boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_member uuid;
begin
  select m.id into v_member
  from public.members m join public.hw_homeworks h on h.member_id = m.id
  where m.hw_token = p_token and h.id = p_homework_id;
  if v_member is null then raise exception 'invalid'; end if;
  if p_date < current_date - 7 or p_date > current_date + 1 then raise exception 'date out of range'; end if;
  if p_done then
    insert into public.hw_logs (homework_id, member_id, done_date)
    values (p_homework_id, v_member, p_date) on conflict do nothing;
  else
    delete from public.hw_logs where homework_id = p_homework_id and done_date = p_date;
  end if;
end $$;

create or replace function public.hw_member_report(p_token text, p_date date, p_feeling int, p_comment text)
returns void language plpgsql security definer set search_path = public as $$
declare v_member uuid;
begin
  select id into v_member from public.members where hw_token = p_token;
  if v_member is null then raise exception 'invalid'; end if;
  if p_date < current_date - 7 or p_date > current_date + 1 then raise exception 'date out of range'; end if;
  insert into public.hw_reports (member_id, report_date, feeling, comment, created_at)
  values (v_member, p_date, p_feeling, left(coalesce(p_comment, ''), 1000), now())
  on conflict (member_id, report_date)
  do update set feeling = excluded.feeling, comment = excluded.comment, created_at = now();
end $$;

revoke all on function public.hw_member_get(text) from public;
revoke all on function public.hw_member_toggle(text, uuid, date, boolean) from public;
revoke all on function public.hw_member_report(text, date, int, text) from public;
grant execute on function public.hw_member_get(text) to anon, authenticated;
grant execute on function public.hw_member_toggle(text, uuid, date, boolean) to anon, authenticated;
grant execute on function public.hw_member_report(text, date, int, text) to anon, authenticated;

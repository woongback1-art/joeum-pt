-- =============================================================
-- 좋음PT 센터 통합 관리 — Supabase 스키마
-- Supabase 대시보드 > SQL Editor 에 통째로 붙여넣고 Run
-- 여러 번 실행해도 안전하도록 작성됨
-- =============================================================

-- ---------- 직원 프로필 ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  email text,
  role text not null default 'pending' check (role in ('admin', 'trainer', 'pending')),
  color text not null default '#23634A',
  created_at timestamptz not null default now()
);

-- 가입하면 프로필 자동 생성. 맨 처음 가입한 사람은 관리자, 그 뒤로는 승인 대기
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_first boolean;
begin
  select not exists (select 1 from public.profiles) into is_first;
  insert into public.profiles (id, name, email, role)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'name', ''), split_part(new.email, '@', 1)),
    new.email,
    case when is_first then 'admin' else 'pending' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 권한 확인용 함수 (RLS 안에서 재귀 없이 쓰기 위해 security definer)
create or replace function public.my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role in ('admin', 'trainer') from public.profiles where id = auth.uid()), false);
$$;

-- ---------- 회원 ----------
create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  trainer_id uuid references public.profiles(id) on delete set null,
  goal text,
  memo text,
  created_at timestamptz not null default now()
);

-- ---------- 수강권 ----------
create table if not exists public.passes (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  name text not null,                 -- 예: PT 30회
  total_count int not null check (total_count > 0),
  used_before int not null default 0, -- 프로그램 쓰기 전에 이미 쓴 횟수 (이전 시스템에서 옮겨올 때)
  start_date date not null default current_date,
  end_date date not null,
  created_at timestamptz not null default now()
);

-- ---------- 예약 / 출석 ----------
create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  trainer_id uuid references public.profiles(id) on delete set null,
  pass_id uuid references public.passes(id) on delete set null,
  starts_at timestamptz not null,
  duration_min int not null default 60,
  status text not null default 'reserved' check (status in ('reserved', 'done', 'noshow', 'canceled')),
  created_at timestamptz not null default now()
);
create index if not exists sessions_starts_at_idx on public.sessions (starts_at);
create index if not exists sessions_member_idx on public.sessions (member_id);

-- ---------- 수업일지 (운동 여러 개: items = [{exercise, check, video}]) ----------
create table if not exists public.journals (
  id uuid primary key default gen_random_uuid(),
  session_id uuid unique references public.sessions(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  trainer_id uuid references public.profiles(id) on delete set null,
  items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists journals_member_idx on public.journals (member_id);

-- ---------- 결제 ----------
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  trainer_id uuid references public.profiles(id) on delete set null, -- 매출이 잡히는 강사
  pass_id uuid references public.passes(id) on delete set null,
  paid_on date not null default current_date,
  item text not null,
  method text not null default '카드',
  amount int not null check (amount >= 0),
  created_at timestamptz not null default now()
);

-- ---------- 공지 · 매뉴얼 ----------
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'notice' check (kind in ('notice', 'manual')),
  title text not null,
  body text not null default '',
  author_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------- 할 일 ----------
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  owner_id uuid references public.profiles(id) on delete set null,
  due_date date,
  done boolean not null default false,
  created_at timestamptz not null default now()
);

-- =============================================================
-- 권한 (Row Level Security)
--  · 승인된 직원(관리자·강사)만 데이터 접근
--  · 매출(결제): 관리자는 전체, 강사는 본인 매출만
--  · 직원 승인/권한 변경, 삭제는 관리자만
-- =============================================================
alter table public.profiles enable row level security;
alter table public.members  enable row level security;
alter table public.passes   enable row level security;
alter table public.sessions enable row level security;
alter table public.journals enable row level security;
alter table public.payments enable row level security;
alter table public.posts    enable row level security;
alter table public.tasks    enable row level security;

-- 기존 정책 지우고 다시 만들기
do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies
           where schemaname = 'public'
             and tablename in ('profiles','members','passes','sessions','journals','payments','posts','tasks')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- profiles: 본인 것은 항상 보임(승인 대기 화면용), 직원은 전체 보임
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_staff());
create policy profiles_update_admin on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy profiles_delete_admin on public.profiles for delete to authenticated
  using (public.is_admin() and id <> auth.uid());

-- 본인은 이름·색만 바꿀 수 있게 (role 은 못 바꿈)
create or replace function public.update_my_profile(p_name text, p_color text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles
     set name = coalesce(nullif(trim(p_name), ''), name),
         color = coalesce(nullif(p_color, ''), color)
   where id = auth.uid();
$$;

-- 공용 테이블: 직원은 읽기·추가·수정, 삭제는 관리자
do $$
declare t text;
begin
  foreach t in array array['members','passes','sessions','journals','posts','tasks']
  loop
    execute format('create policy %I on public.%I for select to authenticated using (public.is_staff())', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_staff())', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_staff()) with check (public.is_staff())', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.is_admin())', t || '_delete', t);
  end loop;
end $$;

-- 할 일·공지는 작성자 본인도 삭제 가능
create policy tasks_delete_owner on public.tasks for delete to authenticated
  using (public.is_staff() and owner_id = auth.uid());
create policy posts_delete_author on public.posts for delete to authenticated
  using (public.is_staff() and author_id = auth.uid());

-- 결제: 관리자 전체 / 강사는 본인 매출만 보고, 본인 이름으로만 등록
create policy payments_select on public.payments for select to authenticated
  using (public.is_admin() or (public.is_staff() and trainer_id = auth.uid()));
create policy payments_insert on public.payments for insert to authenticated
  with check (public.is_admin() or (public.is_staff() and trainer_id = auth.uid()));
create policy payments_update on public.payments for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy payments_delete on public.payments for delete to authenticated
  using (public.is_admin());

-- API 에서 테이블 쓸 수 있게 권한 부여 (실제 접근은 위 RLS 가 제한)
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke all on all tables in schema public from anon;
grant execute on function public.is_admin(), public.is_staff(), public.my_role(), public.update_my_profile(text, text) to authenticated;

-- =============================================================
-- 운동 영상 저장소 (비공개 버킷, 직원만 올리기·보기)
-- =============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('videos', 'videos', false, 52428800, array['video/mp4','video/quicktime','video/webm','video/3gpp','video/x-m4v'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists videos_select on storage.objects;
drop policy if exists videos_insert on storage.objects;
drop policy if exists videos_delete on storage.objects;
create policy videos_select on storage.objects for select to authenticated
  using (bucket_id = 'videos' and public.is_staff());
create policy videos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'videos' and public.is_staff());
create policy videos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'videos' and (public.is_admin() or owner = auth.uid()));

-- =============================================================
-- 수강권 사용 횟수 (출석 처리된 수업 수)
-- =============================================================
create or replace view public.pass_usage
with (security_invoker = true) as
  select pass_id, count(*)::int as used
    from public.sessions
   where status = 'done' and pass_id is not null
   group by pass_id;
grant select on public.pass_usage to authenticated;

-- =============================================================
-- 강사 회당 수업료 (프리랜서 3.3% 계산용, 기본 30,000원)
-- 관리자만 바꿀 수 있음 (profiles 수정 권한이 관리자에게만 있음)
-- =============================================================
alter table public.profiles add column if not exists session_pay int not null default 30000;

-- =============================================================
-- 일정 삭제: 관리자는 전부, 강사는 본인 담당 일정만 (출석 처리된 것 포함)
-- 지우면 연결된 수업일지도 같이 지워짐 (on delete cascade)
-- =============================================================
drop policy if exists sessions_delete_own on public.sessions;
create policy sessions_delete_own on public.sessions for delete to authenticated
  using (public.is_staff() and trainer_id = auth.uid());

-- 수업 기본 시간 60분
alter table public.sessions alter column duration_min set default 60;

-- 수업일지 삭제: 관리자는 전부, 강사는 본인이 쓴 일지
drop policy if exists journals_delete_own on public.journals;
create policy journals_delete_own on public.journals for delete to authenticated
  using (public.is_staff() and trainer_id = auth.uid());

-- =============================================================
-- 회원에게 일지 공유 (일지마다 링크)
--  · share_token 이 있는 일지만, 그 토큰을 아는 사람(로그인 없이)이 볼 수 있음
--  · 보이는 것: 회원 이름, 수업 날짜, 담당 강사, 운동 내용·영상 (다른 정보는 안 보임)
-- =============================================================
alter table public.journals add column if not exists share_token text unique;

create or replace function public.get_shared_journal(p_token text)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'member', m.name,
    'trainer', p.name,
    'starts_at', s.starts_at,
    'items', j.items,
    'updated_at', j.updated_at
  )
  from public.journals j
  join public.members m on m.id = j.member_id
  left join public.sessions s on s.id = j.session_id
  left join public.profiles p on p.id = j.trainer_id
  where p_token is not null and length(p_token) >= 20 and j.share_token = p_token
  limit 1;
$$;
grant execute on function public.get_shared_journal(text) to anon, authenticated;

create or replace function public.is_shared_video(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.journals j, jsonb_array_elements(j.items) it
    where j.share_token is not null and it->>'video' = p_name
  );
$$;
grant execute on function public.is_shared_video(text) to anon, authenticated;

drop policy if exists videos_select_shared on storage.objects;
create policy videos_select_shared on storage.objects for select to anon
  using (bucket_id = 'videos' and public.is_shared_video(name));

-- =============================================================
-- 공지·매뉴얼: 관리자만 쓰기·수정·삭제, 강사는 읽기만
-- =============================================================
drop policy if exists posts_insert on public.posts;
drop policy if exists posts_update on public.posts;
drop policy if exists posts_delete_author on public.posts;
create policy posts_insert on public.posts for insert to authenticated with check (public.is_admin());
create policy posts_update on public.posts for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- =============================================================
-- 개인 고정 스케줄 (매주 반복: 병원 근무, 점심 등)
--  · 직원은 모두 볼 수 있음 / 본인 것만 추가·수정·삭제 (관리자는 전부)
-- =============================================================
create table if not exists public.blocks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  days int[] not null,            -- 0=일 1=월 … 6=토
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now(),
  check (end_time > start_time)
);
alter table public.blocks enable row level security;
drop policy if exists blocks_select on public.blocks;
drop policy if exists blocks_insert on public.blocks;
drop policy if exists blocks_update on public.blocks;
drop policy if exists blocks_delete on public.blocks;
create policy blocks_select on public.blocks for select to authenticated using (public.is_staff());
create policy blocks_insert on public.blocks for insert to authenticated with check (public.is_admin() or (public.is_staff() and owner_id = auth.uid()));
create policy blocks_update on public.blocks for update to authenticated using (public.is_admin() or (public.is_staff() and owner_id = auth.uid())) with check (public.is_admin() or (public.is_staff() and owner_id = auth.uid()));
create policy blocks_delete on public.blocks for delete to authenticated using (public.is_admin() or (public.is_staff() and owner_id = auth.uid()));
grant select, insert, update, delete on public.blocks to authenticated;

-- =============================================================
-- 수업일지: 오늘의 컨디션 · 운동 강도
-- =============================================================
alter table public.journals add column if not exists condition text;
alter table public.journals add column if not exists intensity text;

create or replace function public.get_shared_journal(p_token text)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'member', m.name,
    'trainer', p.name,
    'starts_at', s.starts_at,
    'items', j.items,
    'condition', j.condition,
    'intensity', j.intensity,
    'updated_at', j.updated_at
  )
  from public.journals j
  join public.members m on m.id = j.member_id
  left join public.sessions s on s.id = j.session_id
  left join public.profiles p on p.id = j.trainer_id
  where p_token is not null and length(p_token) >= 20 and j.share_token = p_token
  limit 1;
$$;
grant execute on function public.get_shared_journal(text) to anon, authenticated;

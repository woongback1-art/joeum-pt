-- 식단표 v4: 회원마다 고정 링크 하나 (?m=diet_token)
--  · 회원이 링크를 열면 오늘이 들어 있는 식단표(없으면 가장 최근 것)가 나옴
--  · 선생님이 새 식단표를 만들면 같은 링크에 자동으로 나옴
alter table public.members add column if not exists diet_token text not null
  default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
create unique index if not exists members_diet_token_key on public.members (diet_token);

create or replace function public.get_member_diet(p_token text, p_diet_id uuid default null)
returns json language plpgsql stable security definer set search_path = public
as $$
declare
  m public.members;
  cur public.diets;
  lst json;
  today date := (now() at time zone 'Asia/Seoul')::date;
begin
  if p_token is null or length(p_token) < 20 then return null; end if;
  select * into m from public.members where diet_token = p_token;
  if not found then return null; end if;
  select coalesce(json_agg(json_build_object('id', id, 'start_date', start_date, 'num_days', num_days) order by start_date desc), '[]'::json)
    into lst from public.diets where member_id = m.id;
  if p_diet_id is not null then
    select * into cur from public.diets where id = p_diet_id and member_id = m.id;
  end if;
  if cur.id is null then
    select * into cur from public.diets where member_id = m.id and today between start_date and start_date + num_days - 1 order by start_date desc limit 1;
  end if;
  if cur.id is null then
    select * into cur from public.diets where member_id = m.id order by start_date desc limit 1;
  end if;
  return json_build_object('member', m.name, 'list', lst,
    'diet', case when cur.id is null then null else json_build_object('id', cur.id, 'start_date', cur.start_date, 'num_days', cur.num_days, 'days', cur.days, 'memo', cur.memo) end);
end;
$$;
grant execute on function public.get_member_diet(text, uuid) to anon, authenticated;

create or replace function public.save_member_diet(p_token text, p_diet_id uuid, p_days jsonb)
returns boolean language plpgsql security definer set search_path = public
as $$
begin
  if p_token is null or length(p_token) < 20 or p_diet_id is null then return false; end if;
  if p_days is null or jsonb_typeof(p_days) <> 'array' or jsonb_array_length(p_days) > 31 or length(p_days::text) > 200000 then
    raise exception 'invalid diet data';
  end if;
  update public.diets d set days = p_days, member_updated_at = now(), updated_at = now()
    from public.members m
   where m.diet_token = p_token and d.member_id = m.id and d.id = p_diet_id;
  return found;
end;
$$;
grant execute on function public.save_member_diet(text, uuid, jsonb) to anon, authenticated;

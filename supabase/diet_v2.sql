-- 식단표 v2: 회원이 링크에서 직접 적고 저장
alter table public.diets add column if not exists member_updated_at timestamptz;

create or replace function public.save_shared_diet(p_token text, p_days jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_token is null or length(p_token) < 20 then return false; end if;
  if p_days is null or jsonb_typeof(p_days) <> 'array' or jsonb_array_length(p_days) > 7 or length(p_days::text) > 30000 then
    raise exception 'invalid diet data';
  end if;
  update public.diets set days = p_days, member_updated_at = now(), updated_at = now()
   where share_token = p_token;
  return found;
end;
$$;
grant execute on function public.save_shared_diet(text, jsonb) to anon, authenticated;

create or replace function public.get_shared_diet(p_token text)
returns json language sql stable security definer set search_path = public
as $$
  select json_build_object('member', m.name, 'start_date', d.start_date, 'days', d.days, 'memo', d.memo, 'updated_at', d.updated_at)
  from public.diets d
  join public.members m on m.id = d.member_id
  where p_token is not null and length(p_token) >= 20 and d.share_token = p_token
  limit 1;
$$;

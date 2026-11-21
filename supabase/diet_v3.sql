-- 식단표 v3: 기간 직접 정하기 (1~31일)
alter table public.diets add column if not exists num_days int not null default 7;
alter table public.diets drop constraint if exists diets_num_days_check;
alter table public.diets add constraint diets_num_days_check check (num_days between 1 and 31);

create or replace function public.save_shared_diet(p_token text, p_days jsonb)
returns boolean language plpgsql security definer set search_path = public
as $$
begin
  if p_token is null or length(p_token) < 20 then return false; end if;
  if p_days is null or jsonb_typeof(p_days) <> 'array' or jsonb_array_length(p_days) > 31 or length(p_days::text) > 200000 then
    raise exception 'invalid diet data';
  end if;
  update public.diets set days = p_days, member_updated_at = now(), updated_at = now() where share_token = p_token;
  return found;
end;
$$;
grant execute on function public.save_shared_diet(text, jsonb) to anon, authenticated;

create or replace function public.get_shared_diet(p_token text)
returns json language sql stable security definer set search_path = public
as $$
  select json_build_object('member', m.name, 'start_date', d.start_date, 'num_days', d.num_days, 'days', d.days, 'memo', d.memo, 'updated_at', d.updated_at)
  from public.diets d
  join public.members m on m.id = d.member_id
  where p_token is not null and length(p_token) >= 20 and d.share_token = p_token
  limit 1;
$$;

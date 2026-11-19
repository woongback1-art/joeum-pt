-- 숙제에 운동 방법 칸 추가
alter table public.hw_homeworks add column if not exists how_to text not null default '';

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
                                        'sets', h.sets, 'reps', h.reps, 'unit', h.unit, 'note', h.note, 'how_to', h.how_to,
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

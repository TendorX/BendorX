create or replace function public.tx_community_stats(p_tid bigint, p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_community public.communities%rowtype;
  v_result jsonb;
begin
  select *
    into v_community
  from public.communities
  where id = p_id
    and owner_tid = p_tid;

  if not found then
    raise exception 'Нет доступа к статистике этой публикации'
      using errcode = 'TX403';
  end if;

  select jsonb_build_object(
    'clicks_today', (select count(*) from public.community_click_events e where e.community_id = p_id and e.created_at >= date_trunc('day', now())),
    'clicks_week', (select count(*) from public.community_click_events e where e.community_id = p_id and e.created_at >= now() - interval '7 days'),
    'clicks_all', coalesce(v_community.clicks, 0),
    'votes_today', (select count(*) from public.votes v where v.community_id = p_id and v.valid = true and v.created_at >= date_trunc('day', now())),
    'votes_all', (select count(*) from public.votes v where v.community_id = p_id and v.valid = true),
    'daily_clicks', coalesce((
      select jsonb_agg(jsonb_build_object('date', to_char(days.day, 'YYYY-MM-DD'), 'clicks', coalesce(day_counts.clicks, 0)) order by days.day)
      from generate_series(current_date - 13, current_date, interval '1 day') as days(day)
      left join lateral (
        select count(*) as clicks
        from public.community_click_events e
        where e.community_id = p_id
          and e.created_at >= days.day
          and e.created_at < days.day + interval '1 day'
      ) day_counts on true
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$function$;

revoke all on function public.tx_community_stats(bigint, bigint) from public, anon, authenticated;
grant execute on function public.tx_community_stats(bigint, bigint) to service_role;

-- Bendor-X: allow one to three categories per community.
begin;

alter table public.communities
  add column if not exists category_ids integer[] not null default '{}';

update public.communities
set category_ids = array[category_id]
where cardinality(category_ids) = 0 and category_id is not null;

create index if not exists communities_category_ids_gin
  on public.communities using gin(category_ids);

create or replace function public.tx_submit_multi(
  p_tid bigint, p_username text, p_title text, p_desc text,
  p_cats integer[], p_tags text[], p_kind text
) returns bigint
language plpgsql security definer set search_path=public, pg_temp as $$
declare
  u text;
  v bigint;
  cats integer[];
begin
  if coalesce((select banned from profiles where tid = p_tid), true) then
    raise exception 'Аккаунт ограничен' using errcode = 'TX001';
  end if;

  u := lower(regexp_replace(coalesce(p_username, ''), '^@', ''));
  if u !~ '^[a-z0-9_]{4,32}$' then
    raise exception 'Ссылка неверная' using errcode = 'TX002';
  end if;
  if exists (select 1 from communities where lower(username) = u) then
    raise exception 'Сообщество уже добавлено' using errcode = 'TX003';
  end if;
  if char_length(coalesce(p_title, '')) < 2 or char_length(p_title) > 80 then
    raise exception 'Название: 2–80 символов' using errcode = 'TX004';
  end if;
  if coalesce(cardinality(p_cats), 0) < 1 or cardinality(p_cats) > 3 then
    raise exception 'Выберите от 1 до 3 категорий' using errcode = 'TX005';
  end if;
  if exists (
    select 1 from unnest(p_cats) selected(id)
    left join categories c on c.id = selected.id and c.active
    where c.id is null
  ) then
    raise exception 'Выбрана недействующая категория' using errcode = 'TX005';
  end if;

  select array_agg(distinct selected.id order by selected.id)
    into cats from unnest(p_cats) selected(id);
  if cardinality(cats) < 1 or cardinality(cats) > 3 then
    raise exception 'Выберите от 1 до 3 категорий' using errcode = 'TX005';
  end if;

  if p_kind not in ('group','supergroup','channel') then p_kind := 'group'; end if;

  begin
    insert into communities(
      owner_tid, username, link, title, description, kind,
      category_id, category_ids, tags
    )
    values (
      p_tid, u, 'https://t.me/' || u, trim(p_title),
      left(coalesce(p_desc, ''), 500), p_kind,
      cats[1], cats, coalesce(p_tags, '{}')
    ) returning id into v;
  exception when unique_violation then
    raise exception 'Сообщество уже добавлено' using errcode = 'TX003';
  end;

  insert into audit_log(actor_tid, action, target)
  values (p_tid, 'submit', 'community:' || v);
  return v;
end $$;

create or replace function public.tx_catalog(
  p_q text default null, p_cat int default null,
  p_sort text default 'top', p_limit int default 100
)
returns table(
  id bigint, title text, username text, description text,
  category_id int, category text, tags text[],
  votes bigint, rank bigint, growth bigint, created_at timestamptz
)
language sql stable security definer set search_path=public, pg_temp as $$
  with v as (
    select community_id,
      count(*) filter (where valid) as n,
      count(*) filter (where valid and created_at > now() - interval '7 days') as g
    from votes group by 1
  ),
  r as (
    select m.id, m.title, m.username, m.description, m.category_id,
      coalesce(nullif(m.category_ids, '{}'::integer[]), array[m.category_id]) as category_ids,
      m.tags, m.created_at, m.approved_at,
      coalesce(v.n, 0) as votes, coalesce(v.g, 0) as growth,
      rank() over (order by coalesce(v.n, 0) desc, m.approved_at) as rank
    from communities m left join v on v.community_id = m.id
    where m.status = 'approved'
  )
  select r.id, r.title, r.username, r.description, r.category_id,
    (select string_agg(c.title, ', ' order by c.sort, c.id)
      from categories c where c.id = any(r.category_ids)),
    r.tags, r.votes, r.rank, r.growth, r.created_at
  from r
  where (p_cat is null or p_cat = any(r.category_ids))
    and (
      nullif(trim(p_q), '') is null
      or r.title ilike '%' || trim(p_q) || '%'
      or r.description ilike '%' || trim(p_q) || '%'
      or exists (select 1 from categories c where c.id = any(r.category_ids) and c.title ilike '%' || trim(p_q) || '%')
      or exists (select 1 from unnest(r.tags) t where t ilike '%' || trim(p_q) || '%')
    )
  order by
    case p_sort when 'new' then extract(epoch from r.created_at)
      when 'growth' then r.growth::numeric else r.votes::numeric end desc,
    r.id
  limit least(greatest(coalesce(p_limit, 100), 1), 200)
$$;

create or replace function public.tx_categories()
returns table(id int, slug text, title text, icon text, groups bigint)
language sql stable security definer set search_path=public, pg_temp as $$
  select c.id, c.slug, c.title, c.icon,
    (select count(*) from communities m
      where m.status = 'approved'
        and c.id = any(coalesce(nullif(m.category_ids, '{}'::integer[]), array[m.category_id])))
  from categories c where c.active
  order by c.sort, c.id
$$;

create or replace function public.tx_queue(p_actor bigint)
returns jsonb language plpgsql stable security definer set search_path=public, pg_temp as $$
begin
  if not tx_is_staff(p_actor) then
    raise exception 'Недостаточно прав' using errcode = 'TX403';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', m.id, 'title', m.title, 'username', m.username,
      'description', m.description,
      'category', (select string_agg(c.title, ', ' order by c.sort, c.id)
        from categories c where c.id = any(coalesce(nullif(m.category_ids, '{}'::integer[]), array[m.category_id]))),
      'owner', p.name, 'at', m.created_at
    ) order by m.id)
    from communities m
    left join profiles p on p.tid = m.owner_tid
    where m.status = 'pending'
  ), '[]'::jsonb);
end $$;

revoke all on function public.tx_submit_multi(bigint,text,text,text,integer[],text[],text) from public, anon, authenticated;
grant execute on function public.tx_submit_multi(bigint,text,text,text,integer[],text[],text) to service_role;
revoke all on function public.tx_catalog(text,integer,text,integer) from public;
grant execute on function public.tx_catalog(text,integer,text,integer) to anon, authenticated, service_role;
revoke all on function public.tx_categories() from public;
grant execute on function public.tx_categories() to anon, authenticated, service_role;
revoke all on function public.tx_queue(bigint) from public, anon, authenticated;
grant execute on function public.tx_queue(bigint) to service_role;

notify pgrst, 'reload schema';
commit;

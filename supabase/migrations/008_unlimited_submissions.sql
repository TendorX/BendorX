-- Bendor-X: remove any legacy per-user daily submission cap.
-- Submission is intentionally unlimited; duplicate, validation and account-ban
-- checks remain in place. Rate limits for unrelated actions are unchanged.

begin;

create or replace function public.tx_submit_multi(
  p_tid bigint,
  p_username text,
  p_title text,
  p_desc text,
  p_cats integer[],
  p_tags text[],
  p_kind text
) returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  u text;
  v bigint;
  cats integer[];
begin
  if coalesce((select banned from public.profiles where tid = p_tid), true) then
    raise exception 'Аккаунт ограничен' using errcode = 'TX001';
  end if;

  u := lower(regexp_replace(coalesce(p_username, ''), '^@', ''));
  if u !~ '^[a-z0-9_]{4,32}$' then
    raise exception 'Ссылка неверная' using errcode = 'TX002';
  end if;

  if exists (select 1 from public.communities where lower(username) = u) then
    raise exception 'Сообщество уже добавлено' using errcode = 'TX003';
  end if;

  if char_length(coalesce(p_title, '')) < 2 or char_length(p_title) > 80 then
    raise exception 'Название: 2–80 символов' using errcode = 'TX004';
  end if;

  if coalesce(cardinality(p_cats), 0) < 1 or cardinality(p_cats) > 3 then
    raise exception 'Выберите от 1 до 3 категорий' using errcode = 'TX005';
  end if;

  if exists (
    select 1
    from unnest(p_cats) selected(id)
    left join public.categories c on c.id = selected.id and c.active
    where c.id is null
  ) then
    raise exception 'Выбрана недействующая категория' using errcode = 'TX005';
  end if;

  select array_agg(distinct selected.id order by selected.id)
    into cats
  from unnest(p_cats) selected(id);

  if cardinality(cats) < 1 or cardinality(cats) > 3 then
    raise exception 'Выберите от 1 до 3 категорий' using errcode = 'TX005';
  end if;

  if p_kind not in ('group', 'supergroup', 'channel') then
    p_kind := 'group';
  end if;

  -- No daily or per-user submission counter/check here by design.
  begin
    insert into public.communities(
      owner_tid, username, link, title, description, kind,
      category_id, category_ids, tags
    )
    values (
      p_tid, u, 'https://t.me/' || u, trim(p_title),
      left(coalesce(p_desc, ''), 500), p_kind,
      cats[1], cats, coalesce(p_tags, '{}')
    )
    returning id into v;
  exception when unique_violation then
    raise exception 'Сообщество уже добавлено' using errcode = 'TX003';
  end;

  insert into public.audit_log(actor_tid, action, target)
  values (p_tid, 'submit', 'community:' || v);

  return v;
end;
$$;

revoke all on function public.tx_submit_multi(bigint, text, text, text, integer[], text[], text[])
  from public, anon, authenticated;
grant execute on function public.tx_submit_multi(bigint, text, text, text, integer[], text[], text[])
  to service_role;

commit;

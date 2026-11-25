-- Bendor-X: add the «Личный блог» category.
-- Safe to run more than once.
begin;

insert into public.categories (slug, title, icon, sort, active)
values ('personal-blog', 'Личный блог', '✍️', 95, true)
on conflict (slug) do update
set title = excluded.title,
    icon = excluded.icon,
    active = true;

notify pgrst, 'reload schema';
commit;

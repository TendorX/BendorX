-- Permanently remove the old demo/test listings.
-- Exact matches only: "Тест", "Тест 1", "Тест 2", ... (case/spacing insensitive).
-- New submissions with these titles can still be added through the normal moderation flow.
delete from public.communities
where lower(btrim(coalesce(title, ''))) ~ '^тест([[:space:]]+[0-9]+)?$';

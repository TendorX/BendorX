-- Bendor-X: подробные данные для очереди модерации.
-- Безопасное обновление: существующие профили и заявки не изменяются и не удаляются.
BEGIN;

CREATE OR REPLACE FUNCTION public.tx_queue(p_actor bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
    IF NOT public.tx_is_staff(p_actor) THEN
        RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = 'TX403';
    END IF;

    RETURN COALESCE(
        (
            SELECT jsonb_agg(
                jsonb_build_object(
                    'id', m.id,
                    'title', m.title,
                    'username', m.username,
                    'link', m.link,
                    'description', m.description,
                    'kind', m.kind,
                    'category_id', m.category_id,
                    'category', c.title,
                    'tags', m.tags,
                    'owner', COALESCE(p.name, 'Пользователь Telegram'),
                    'owner_username', p.username,
                    'owner_tid', m.owner_tid::text,
                    'at', m.created_at
                )
                ORDER BY m.created_at DESC, m.id DESC
            )
            FROM public.communities m
            LEFT JOIN public.categories c ON c.id = m.category_id
            LEFT JOIN public.profiles p ON p.tid = m.owner_tid
            WHERE m.status = 'pending'
              AND m.deleted_at IS NULL
        ),
        '[]'::jsonb
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.tx_queue(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tx_queue(bigint) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;

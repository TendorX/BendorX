
-- =========================================================
-- TENDORX — 002_repair.sql
-- Additive repair migration
-- Existing data and RLS policies are preserved.
-- =========================================================

BEGIN;

-- ---------------------------------------------------------
-- 1. Missing columns and indexes
-- ---------------------------------------------------------

ALTER TABLE public.communities
    ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE public.notifications
    ADD COLUMN IF NOT EXISTS read_at timestamptz;

CREATE INDEX IF NOT EXISTS communities_deleted_at_idx
    ON public.communities (deleted_at);

CREATE INDEX IF NOT EXISTS notifications_unread_idx
    ON public.notifications (tid, id DESC)
    WHERE read_at IS NULL;


-- ---------------------------------------------------------
-- 2. Voting: cancel and restore while preserving history
-- ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tx_vote(
    p_tid bigint,
    p_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_community public.communities%ROWTYPE;
    v_valid boolean;
    v_existing boolean;
    v_limit integer;
    v_count integer;
    v_added boolean := false;
BEGIN
    IF COALESCE(
        (SELECT p.banned FROM public.profiles p WHERE p.tid = p_tid),
        true
    ) THEN
        RAISE EXCEPTION 'Аккаунт ограничен'
            USING ERRCODE = 'TX001';
    END IF;

    SELECT *
    INTO v_community
    FROM public.communities
    WHERE id = p_id
      AND status = 'approved'
      AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Сообщество недоступно'
            USING ERRCODE = 'TX002';
    END IF;

    IF v_community.owner_tid = p_tid THEN
        RAISE EXCEPTION 'Нельзя голосовать за своё сообщество'
            USING ERRCODE = 'TX003';
    END IF;

    SELECT COALESCE((s.value #>> '{}')::integer, 30)
    INTO v_limit
    FROM public.settings s
    WHERE s.key = 'votes_per_hour';

    v_limit := COALESCE(v_limit, 30);

    SELECT v.valid
    INTO v_valid
    FROM public.votes v
    WHERE v.community_id = p_id
      AND v.tid = p_tid
    FOR UPDATE;

    v_existing := FOUND;

    -- Already active: no new vote.
    IF v_existing AND v_valid THEN
        RETURN jsonb_build_object(
            'added', false,
            'votes', (
                SELECT count(*)
                FROM public.votes
                WHERE community_id = p_id
                  AND valid = true
            )
        );
    END IF;

    -- Count recent vote records, excluding the record
    -- being restored.
    SELECT count(*)
    INTO v_count
    FROM public.votes v
    WHERE v.tid = p_tid
      AND v.created_at > now() - interval '1 hour'
      AND NOT (
          v.community_id = p_id
          AND v.tid = p_tid
      );

    IF v_count >= v_limit THEN
        RAISE EXCEPTION 'Слишком много голосов за час, попробуйте позже'
            USING ERRCODE = 'TX004';
    END IF;

    IF v_existing THEN
        -- Restoring a previously cancelled vote.
        PERFORM public.tx_rate_limit_consume(
            'vote',
            p_tid,
            30,
            3600
        );

        UPDATE public.votes
        SET valid = true,
            cancel_reason = NULL,
            created_at = now()
        WHERE community_id = p_id
          AND tid = p_tid;

        v_added := true;
    ELSE
        -- New vote. Existing BEFORE INSERT trigger
        -- applies the rate limit.
        INSERT INTO public.votes (community_id, tid)
        VALUES (p_id, p_tid)
        ON CONFLICT (community_id, tid) DO NOTHING;

        GET DIAGNOSTICS v_count = ROW_COUNT;
        v_added := v_count > 0;
    END IF;

    IF v_added THEN
        INSERT INTO public.notifications (tid, title, body)
        VALUES (
            v_community.owner_tid,
            'Новый голос',
            v_community.title
        );
    END IF;

    RETURN jsonb_build_object(
        'added', v_added,
        'votes', (
            SELECT count(*)
            FROM public.votes
            WHERE community_id = p_id
              AND valid = true
        )
    );
END;
$function$;


CREATE OR REPLACE FUNCTION public.tx_unvote(
    p_tid bigint,
    p_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_removed boolean := false;
BEGIN
    IF COALESCE(
        (SELECT p.banned FROM public.profiles p WHERE p.tid = p_tid),
        true
    ) THEN
        RAISE EXCEPTION 'Аккаунт ограничен'
            USING ERRCODE = 'TX001';
    END IF;

    UPDATE public.votes
    SET valid = false,
        cancel_reason = 'user_unvote'
    WHERE community_id = p_id
      AND tid = p_tid
      AND valid = true;

    v_removed := FOUND;

    RETURN jsonb_build_object(
        'removed', v_removed,
        'votes', (
            SELECT count(*)
            FROM public.votes
            WHERE community_id = p_id
              AND valid = true
        )
    );
END;
$function$;


-- ---------------------------------------------------------
-- 3. Click tracking
-- ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tx_track_click(
    p_tid bigint,
    p_id bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
    IF COALESCE(
        (SELECT p.banned FROM public.profiles p WHERE p.tid = p_tid),
        true
    ) THEN
        RAISE EXCEPTION 'Аккаунт ограничен'
            USING ERRCODE = 'TX001';
    END IF;

    UPDATE public.communities
    SET clicks = clicks + 1
    WHERE id = p_id
      AND status = 'approved'
      AND deleted_at IS NULL;
END;
$function$;


CREATE OR REPLACE FUNCTION public.tx_click(p_id bigint)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
    UPDATE public.communities
    SET clicks = clicks + 1
    WHERE id = p_id
      AND status = 'approved'
      AND deleted_at IS NULL;
$function$;


-- ---------------------------------------------------------
-- 4. Read notifications
-- NULL p_id means mark all notifications as read.
-- ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tx_notes_read(
    p_tid bigint,
    p_id bigint
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_count integer;
BEGIN
    IF COALESCE(
        (SELECT p.banned FROM public.profiles p WHERE p.tid = p_tid),
        true
    ) THEN
        RAISE EXCEPTION 'Аккаунт ограничен'
            USING ERRCODE = 'TX001';
    END IF;

    UPDATE public.notifications
    SET read_at = now()
    WHERE tid = p_tid
      AND read_at IS NULL
      AND (p_id IS NULL OR id = p_id);

    GET DIAGNOSTICS v_count = ROW_COUNT;

    RETURN v_count;
END;
$function$;


-- ---------------------------------------------------------
-- 5. Admin permissions
-- Only master_admin, admin and moderator.
-- ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tx_admin_delete(
    p_actor bigint,
    p_id bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_title text;
BEGIN
    IF NOT COALESCE(
        (
            SELECT p.role IN ('master_admin', 'admin', 'moderator')
                   AND NOT p.banned
            FROM public.profiles p
            WHERE p.tid = p_actor
        ),
        false
    ) THEN
        RAISE EXCEPTION 'Недостаточно прав'
            USING ERRCODE = 'TX403';
    END IF;

    UPDATE public.communities
    SET deleted_at = now()
    WHERE id = p_id
      AND deleted_at IS NULL
    RETURNING title INTO v_title;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Сообщество не найдено или уже удалено'
            USING ERRCODE = 'TX006';
    END IF;

    INSERT INTO public.audit_log (
        actor_tid, action, target, details
    )
    VALUES (
        p_actor,
        'community_delete',
        'community:' || p_id,
        jsonb_build_object('title', v_title)
    );
END;
$function$;


CREATE OR REPLACE FUNCTION public.tx_admin_restore(
    p_actor bigint,
    p_id bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_title text;
BEGIN
    IF NOT COALESCE(
        (
            SELECT p.role IN ('master_admin', 'admin', 'moderator')
                   AND NOT p.banned
            FROM public.profiles p
            WHERE p.tid = p_actor
        ),
        false
    ) THEN
        RAISE EXCEPTION 'Недостаточно прав'
            USING ERRCODE = 'TX403';
    END IF;

    UPDATE public.communities
    SET deleted_at = NULL
    WHERE id = p_id
      AND deleted_at IS NOT NULL
    RETURNING title INTO v_title;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Удалённое сообщество не найдено'
            USING ERRCODE = 'TX006';
    END IF;

    INSERT INTO public.audit_log (
        actor_tid, action, target, details
    )
    VALUES (
        p_actor,
        'community_restore',
        'community:' || p_id,
        jsonb_build_object('title', v_title)
    );
END;
$function$;


CREATE OR REPLACE FUNCTION public.tx_admin_communities(
    p_actor bigint,
    p_deleted boolean
)
RETURNS SETOF public.communities
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
    IF NOT COALESCE(
        (
            SELECT p.role IN ('master_admin', 'admin', 'moderator')
                   AND NOT p.banned
            FROM public.profiles p
            WHERE p.tid = p_actor
        ),
        false
    ) THEN
        RAISE EXCEPTION 'Недостаточно прав'
            USING ERRCODE = 'TX403';
    END IF;

    RETURN QUERY
    SELECT c.*
    FROM public.communities c
    WHERE (c.deleted_at IS NOT NULL) = COALESCE(p_deleted, false)
    ORDER BY c.created_at DESC, c.id DESC;
END;
$function$;


-- ---------------------------------------------------------
-- 6. Catalog excludes deleted communities
-- ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tx_catalog(
    p_q text DEFAULT NULL,
    p_cat integer DEFAULT NULL,
    p_sort text DEFAULT 'top',
    p_limit integer DEFAULT 100
)
RETURNS TABLE(
    id bigint,
    title text,
    username text,
    description text,
    category_id integer,
    category text,
    tags text[],
    votes bigint,
    rank bigint,
    growth bigint,
    created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
    WITH q AS (
        SELECT
            '%' ||
            replace(
                replace(
                    replace(trim(coalesce(p_q, '')), '\', '\\'),
                    '%', '\%'
                ),
                '_', '\_'
            ) || '%' AS pat
    ),
    v AS (
        SELECT
            community_id,
            count(*) FILTER (WHERE valid) AS n,
            count(*) FILTER (
                WHERE valid
                  AND created_at > now() - interval '7 days'
            ) AS g
        FROM public.votes
        GROUP BY community_id
    ),
    r AS (
        SELECT
            m.id,
            m.title,
            m.username,
            m.description,
            m.category_id,
            m.tags,
            m.created_at,
            m.approved_at,
            coalesce(v.n, 0) AS votes,
            coalesce(v.g, 0) AS growth,
            rank() OVER (
                ORDER BY coalesce(v.n, 0) DESC, m.approved_at
            ) AS rank
        FROM public.communities m
        LEFT JOIN v ON v.community_id = m.id
        WHERE m.status = 'approved'
          AND m.deleted_at IS NULL
    )
    SELECT
        r.id,
        r.title,
        r.username,
        r.description,
        r.category_id,
        c.title,
        r.tags,
        r.votes,
        r.rank,
        r.growth,
        r.created_at
    FROM r
    LEFT JOIN public.categories c ON c.id = r.category_id,
         q
    WHERE
        (p_cat IS NULL OR r.category_id = p_cat)
        AND (
            nullif(trim(p_q), '') IS NULL
            OR r.title ILIKE q.pat
            OR r.description ILIKE q.pat
            OR c.title ILIKE q.pat
            OR EXISTS (
                SELECT 1
                FROM unnest(r.tags) t
                WHERE t ILIKE q.pat
            )
        )
    ORDER BY
        CASE p_sort
            WHEN 'new' THEN extract(epoch FROM r.created_at)
            WHEN 'growth' THEN r.growth::numeric
            ELSE r.votes::numeric
        END DESC,
        r.id
    LIMIT least(greatest(coalesce(p_limit, 100), 1), 200);
$function$;


CREATE OR REPLACE FUNCTION public.tx_categories()
RETURNS TABLE(
    id integer,
    slug text,
    title text,
    icon text,
    groups bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
    SELECT
        c.id,
        c.slug,
        c.title,
        c.icon,
        (
            SELECT count(*)
            FROM public.communities m
            WHERE m.category_id = c.id
              AND m.status = 'approved'
              AND m.deleted_at IS NULL
        )
    FROM public.categories c
    WHERE c.active
    ORDER BY c.sort, c.id;
$function$;


CREATE OR REPLACE FUNCTION public.tx_media()
RETURNS TABLE(id bigint, avatar_path text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
    SELECT c.id, c.avatar_path
    FROM public.communities c
    WHERE c.status = 'approved'
      AND c.deleted_at IS NULL
      AND c.avatar_path IS NOT NULL;
$function$;


-- ---------------------------------------------------------
-- 7. Profile data
-- Deleted communities remain visible to their owner,
-- with deleted_at so the frontend can distinguish them.
-- ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tx_me(p_tid bigint)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
    SELECT jsonb_build_object(
        'role',
        (SELECT p.role FROM public.profiles p WHERE p.tid = p_tid),

        'communities',
        coalesce(
            (
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'id', m.id,
                        'title', m.title,
                        'username', m.username,
                        'status', m.status,
                        'reason', m.reject_reason,
                        'votes', (
                            SELECT count(*)
                            FROM public.votes v
                            WHERE v.community_id = m.id
                              AND v.valid = true
                        ),
                        'clicks', m.clicks,
                        'deleted_at', m.deleted_at
                    )
                    ORDER BY m.id DESC
                )
                FROM public.communities m
                WHERE m.owner_tid = p_tid
            ),
            '[]'::jsonb
        ),

        'favs',
        coalesce(
            (
                SELECT jsonb_agg(f.community_id)
                FROM public.favorites f
                WHERE f.tid = p_tid
            ),
            '[]'::jsonb
        ),

        'voted',
        coalesce(
            (
                SELECT jsonb_agg(v.community_id)
                FROM public.votes v
                WHERE v.tid = p_tid
                  AND v.valid = true
            ),
            '[]'::jsonb
        ),

        'notes',
        coalesce(
            (
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'id', n.id,
                        'title', n.title,
                        'body', n.body,
                        'at', n.created_at,
                        'read_at', n.read_at
                    )
                    ORDER BY n.id DESC
                )
                FROM (
                    SELECT *
                    FROM public.notifications
                    WHERE tid = p_tid
                    ORDER BY id DESC
                    LIMIT 20
                ) n
            ),
            '[]'::jsonb
        )
    );
$function$;


-- ---------------------------------------------------------
-- 8. Moderation cannot modify soft-deleted communities
-- ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tx_moderate(
    p_actor bigint,
    p_id bigint,
    p_status text,
    p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    m public.communities%ROWTYPE;
BEGIN
    IF NOT COALESCE(
        (
            SELECT p.role IN ('master_admin', 'admin', 'moderator')
                   AND NOT p.banned
            FROM public.profiles p
            WHERE p.tid = p_actor
        ),
        false
    ) THEN
        RAISE EXCEPTION 'Недостаточно прав'
            USING ERRCODE = 'TX403';
    END IF;

    IF p_status IS NULL OR
       p_status NOT IN (
           'approved', 'rejected', 'changes', 'hidden', 'blocked'
       ) THEN
        RAISE EXCEPTION 'Неверный статус'
            USING ERRCODE = 'TX004';
    END IF;

    IF p_status IN ('rejected', 'changes', 'blocked')
       AND char_length(coalesce(trim(p_reason), '')) < 3 THEN
        RAISE EXCEPTION 'Укажите причину'
            USING ERRCODE = 'TX005';
    END IF;

    UPDATE public.communities
    SET
        status = p_status,
        reject_reason = CASE
            WHEN p_status IN ('rejected', 'changes', 'blocked')
            THEN left(trim(p_reason), 300)
            ELSE NULL
        END,
        approved_at = CASE
            WHEN p_status = 'approved'
            THEN coalesce(approved_at, now())
            ELSE approved_at
        END
    WHERE id = p_id
      AND deleted_at IS NULL
    RETURNING * INTO m;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Сообщество не найдено'
            USING ERRCODE = 'TX006';
    END IF;

    INSERT INTO public.audit_log (
        actor_tid, action, target, details
    )
    VALUES (
        p_actor,
        'moderate',
        'community:' || p_id,
        jsonb_build_object(
            'status', p_status,
            'reason', p_reason
        )
    );

    INSERT INTO public.notifications (tid, title, body)
    VALUES (
        m.owner_tid,
        CASE p_status
            WHEN 'approved' THEN 'Сообщество одобрено'
            WHEN 'rejected' THEN 'Заявка отклонена'
            WHEN 'changes' THEN 'Нужны исправления'
            WHEN 'hidden' THEN 'Сообщество скрыто'
            ELSE 'Сообщество заблокировано'
        END,
        m.title || coalesce(' — ' || m.reject_reason, '')
    );
END;
$function$;


-- ---------------------------------------------------------
-- 9. Restrict new SECURITY DEFINER RPC functions
-- Server API uses service_role.
-- ---------------------------------------------------------

REVOKE ALL ON FUNCTION public.tx_track_click(bigint, bigint)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tx_track_click(bigint, bigint)
    TO service_role;

REVOKE ALL ON FUNCTION public.tx_unvote(bigint, bigint)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tx_unvote(bigint, bigint)
    TO service_role;

REVOKE ALL ON FUNCTION public.tx_notes_read(bigint, bigint)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tx_notes_read(bigint, bigint)
    TO service_role;

REVOKE ALL ON FUNCTION public.tx_admin_delete(bigint, bigint)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tx_admin_delete(bigint, bigint)
    TO service_role;

REVOKE ALL ON FUNCTION public.tx_admin_restore(bigint, bigint)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tx_admin_restore(bigint, bigint)
    TO service_role;

REVOKE ALL ON FUNCTION public.tx_admin_communities(bigint, boolean)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tx_admin_communities(bigint, boolean)
    TO service_role;


COMMIT;

-- =========================================================
-- END OF 002_repair.sql
-- =========================================================

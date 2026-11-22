-- Bendor-X: date-based top-10 leaderboard and real outbound Telegram visit tracking.
-- Existing profiles, communities and vote history are preserved.
BEGIN;

CREATE TABLE IF NOT EXISTS public.community_click_events (
    id bigserial PRIMARY KEY,
    community_id bigint NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS community_click_events_recent_idx
    ON public.community_click_events (community_id, created_at DESC);

ALTER TABLE public.community_click_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.community_click_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.community_click_events TO service_role;
DROP POLICY IF EXISTS deny_all_client ON public.community_click_events;
CREATE POLICY deny_all_client ON public.community_click_events
    FOR ALL TO anon, authenticated
    USING (false) WITH CHECK (false);

DO $$
DECLARE v_sequence text;
BEGIN
    v_sequence := pg_get_serial_sequence('public.community_click_events', 'id');
    IF v_sequence IS NOT NULL THEN
        EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated', v_sequence);
        EXECUTE format('GRANT USAGE, SELECT, UPDATE ON SEQUENCE %s TO service_role', v_sequence);
    END IF;
END;
$$;

-- Increment the existing counter and append a timestamped event in one operation.
CREATE OR REPLACE FUNCTION public.tx_click(p_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_community_id bigint;
BEGIN
    UPDATE public.communities
    SET clicks = clicks + 1
    WHERE id = p_id
      AND status = 'approved'
      AND deleted_at IS NULL
    RETURNING id INTO v_community_id;

    IF v_community_id IS NOT NULL THEN
        INSERT INTO public.community_click_events (community_id)
        VALUES (v_community_id);
    END IF;
END;
$function$;

-- Authenticated tracking variant used by the Telegram Mini App API.
CREATE OR REPLACE FUNCTION public.tx_track_click(p_tid bigint, p_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
    IF COALESCE(
        (SELECT NOT p.banned FROM public.profiles p WHERE p.tid = p_tid),
        false
    ) IS NOT TRUE THEN
        RAISE EXCEPTION 'Аккаунт ограничен'
            USING ERRCODE = 'TX001';
    END IF;

    PERFORM public.tx_click(p_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.tx_click(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tx_click(bigint) TO service_role;
REVOKE ALL ON FUNCTION public.tx_track_click(bigint, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tx_track_click(bigint, bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.tx_leaderboard(
    p_metric text DEFAULT 'votes',
    p_period text DEFAULT 'all',
    p_limit integer DEFAULT 10
)
RETURNS TABLE(
    place bigint,
    id bigint,
    title text,
    username text,
    description text,
    category_id integer,
    category text,
    votes bigint,
    clicks bigint,
    metric_value bigint,
    created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
    IF p_metric NOT IN ('votes', 'clicks') THEN
        RAISE EXCEPTION 'Неверный тип рейтинга' USING ERRCODE = 'TX004';
    END IF;

    IF p_period NOT IN ('all', '7d', '30d') THEN
        RAISE EXCEPTION 'Неверный период рейтинга' USING ERRCODE = 'TX004';
    END IF;

    RETURN QUERY
    WITH vote_counts AS (
        SELECT
            v.community_id,
            count(*) FILTER (
                WHERE v.valid
                  AND (
                      p_period = 'all'
                      OR v.created_at >= now() - CASE
                          WHEN p_period = '7d' THEN interval '7 days'
                          ELSE interval '30 days'
                      END
                  )
            )::bigint AS period_votes
        FROM public.votes v
        GROUP BY v.community_id
    ),
    click_counts AS (
        SELECT
            ce.community_id,
            count(*) FILTER (
                WHERE (
                    p_period = 'all'
                    OR ce.created_at >= now() - CASE
                        WHEN p_period = '7d' THEN interval '7 days'
                        ELSE interval '30 days'
                    END
                )
            )::bigint AS period_clicks
        FROM public.community_click_events ce
        GROUP BY ce.community_id
    ),
    base AS (
        SELECT
            m.id AS community_id,
            m.title AS community_title,
            m.username AS community_username,
            m.description AS community_description,
            m.category_id AS community_category_id,
            cat.title AS category_title,
            coalesce(vc.period_votes, 0)::bigint AS votes_count,
            coalesce(cc.period_clicks, 0)::bigint AS clicks_count,
            m.created_at AS community_created_at,
            m.approved_at
        FROM public.communities m
        LEFT JOIN public.categories cat ON cat.id = m.category_id
        LEFT JOIN vote_counts vc ON vc.community_id = m.id
        LEFT JOIN click_counts cc ON cc.community_id = m.id
        WHERE m.status = 'approved'
          AND m.deleted_at IS NULL
    ),
    ranked AS (
        SELECT
            row_number() OVER (
                ORDER BY
                    CASE WHEN p_metric = 'votes' THEN b.votes_count ELSE b.clicks_count END DESC,
                    b.votes_count DESC,
                    b.clicks_count DESC,
                    coalesce(b.approved_at, b.community_created_at) DESC,
                    b.community_id DESC
            )::bigint AS position,
            b.*,
            CASE WHEN p_metric = 'votes' THEN b.votes_count ELSE b.clicks_count END::bigint AS score
        FROM base b
    )
    SELECT
        r.position,
        r.community_id,
        r.community_title,
        r.community_username,
        r.community_description,
        r.community_category_id,
        r.category_title,
        r.votes_count,
        r.clicks_count,
        r.score,
        r.community_created_at
    FROM ranked r
    WHERE r.score > 0
    ORDER BY r.position
    LIMIT least(greatest(coalesce(p_limit, 10), 1), 10);
END;
$function$;

REVOKE ALL ON FUNCTION public.tx_leaderboard(text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tx_leaderboard(text, text, integer) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;

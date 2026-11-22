-- Bendor-X: sort recently approved communities by approval time, not submission time.
-- Does not alter existing community, vote, user, or category records.
BEGIN;

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
                ORDER BY coalesce(v.n, 0) DESC, coalesce(m.approved_at, m.created_at) DESC
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
        -- Rankings show only communities that have actually earned votes.
        AND (p_sort <> 'rank_top' OR r.votes > 0)
        -- Weekly growth lists show only communities with activity in the last 7 days.
        AND (p_sort <> 'growth' OR r.growth > 0)
    ORDER BY
        CASE
            WHEN p_sort = 'new'
            THEN extract(epoch FROM coalesce(r.approved_at, r.created_at))
        END DESC NULLS LAST,
        CASE WHEN p_sort = 'growth' THEN r.growth END DESC NULLS LAST,
        CASE WHEN p_sort = 'growth' THEN r.votes END DESC NULLS LAST,
        CASE WHEN p_sort IN ('top', 'rank_top') THEN r.votes END DESC NULLS LAST,
        CASE WHEN p_sort <> 'new' THEN r.growth END DESC NULLS LAST,
        coalesce(r.approved_at, r.created_at) DESC,
        r.id DESC
    LIMIT least(greatest(coalesce(p_limit, 100), 1), 200);
$function$;

NOTIFY pgrst, 'reload schema';
COMMIT;

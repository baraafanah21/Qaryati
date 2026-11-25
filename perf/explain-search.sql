-- EXPLAIN (ANALYZE, BUFFERS) of the statements of GET /villages?q=<term>&size=20
-- for an anonymous caller (published villages, relevance order, first page).
-- Run with scripts/perf/explain-search.sh; the output goes to
-- docs/performance/raw/<label>-explain-search.txt (docs/performance.md).
--
-- The SQL is the text that village-search.sql.ts builds, with the
-- parameters written in. The term is set by the script (-v q=...).

\echo '=== A. Two statements (before #50): the page ==='
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT v.id, v.slug, v.settlement_status, v.publication_status,
       v.display_name_ar, v.display_name_en, v.created_at,
       ST_Y(v.location::geometry) AS latitude,
       ST_X(v.location::geometry) AS longitude,
       GREATEST(
         similarity(v.display_name_ar, :'q'),
         COALESCE(similarity(v.display_name_en, :'q'), 0),
         COALESCE((
           SELECT max(similarity(vn.name_normalized, :'q'))
           FROM village_name vn
           JOIN (SELECT id AS claim_id, village_id FROM claim
                 WHERE claim_type = 'VILLAGE_NAME' AND is_preferred) pn ON pn.claim_id = vn.claim_id
           WHERE pn.village_id = v.id), 0)) AS relevance
FROM village v
WHERE v.publication_status = 'PUBLISHED' AND v.id IN (
  SELECT id FROM village WHERE display_name_ar % :'q'
  UNION
  SELECT id FROM village WHERE display_name_en % :'q'
  UNION
  SELECT pn.village_id
  FROM village_name vn
  JOIN (SELECT id AS claim_id, village_id FROM claim
        WHERE claim_type = 'VILLAGE_NAME' AND is_preferred) pn ON pn.claim_id = vn.claim_id
  WHERE vn.name_normalized % :'q')
ORDER BY relevance DESC NULLS LAST, v.id
LIMIT 20 OFFSET 0;

\echo '=== B. Two statements (before #50): the count, same WHERE ==='
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT count(*)::int AS total
FROM village v
WHERE v.publication_status = 'PUBLISHED' AND v.id IN (
  SELECT id FROM village WHERE display_name_ar % :'q'
  UNION
  SELECT id FROM village WHERE display_name_en % :'q'
  UNION
  SELECT pn.village_id
  FROM village_name vn
  JOIN (SELECT id AS claim_id, village_id FROM claim
        WHERE claim_type = 'VILLAGE_NAME' AND is_preferred) pn ON pn.claim_id = vn.claim_id
  WHERE vn.name_normalized % :'q');

\echo '=== C. One statement, count(*) OVER () ==='
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT v.id, v.slug, v.settlement_status, v.publication_status,
       v.display_name_ar, v.display_name_en, v.created_at,
       ST_Y(v.location::geometry) AS latitude,
       ST_X(v.location::geometry) AS longitude,
       GREATEST(
         similarity(v.display_name_ar, :'q'),
         COALESCE(similarity(v.display_name_en, :'q'), 0),
         COALESCE((
           SELECT max(similarity(vn.name_normalized, :'q'))
           FROM village_name vn
           JOIN (SELECT id AS claim_id, village_id FROM claim
                 WHERE claim_type = 'VILLAGE_NAME' AND is_preferred) pn ON pn.claim_id = vn.claim_id
           WHERE pn.village_id = v.id), 0)) AS relevance,
       count(*) OVER ()::int AS total
FROM village v
WHERE v.publication_status = 'PUBLISHED' AND v.id IN (
  SELECT id FROM village WHERE display_name_ar % :'q'
  UNION
  SELECT id FROM village WHERE display_name_en % :'q'
  UNION
  SELECT pn.village_id
  FROM village_name vn
  JOIN (SELECT id AS claim_id, village_id FROM claim
        WHERE claim_type = 'VILLAGE_NAME' AND is_preferred) pn ON pn.claim_id = vn.claim_id
  WHERE vn.name_normalized % :'q')
ORDER BY relevance DESC NULLS LAST, v.id
LIMIT 20 OFFSET 0;

\echo '=== D. One statement, matching ids once in a CTE, reused for page and count ==='
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
WITH matched AS MATERIALIZED (
  SELECT v.id
  FROM village v
  WHERE v.publication_status = 'PUBLISHED' AND v.id IN (
    SELECT id FROM village WHERE display_name_ar % :'q'
    UNION
    SELECT id FROM village WHERE display_name_en % :'q'
    UNION
    SELECT pn.village_id
    FROM village_name vn
    JOIN (SELECT id AS claim_id, village_id FROM claim
          WHERE claim_type = 'VILLAGE_NAME' AND is_preferred) pn ON pn.claim_id = vn.claim_id
    WHERE vn.name_normalized % :'q')
)
SELECT v.id, v.slug, v.settlement_status, v.publication_status,
       v.display_name_ar, v.display_name_en, v.created_at,
       ST_Y(v.location::geometry) AS latitude,
       ST_X(v.location::geometry) AS longitude,
       GREATEST(
         similarity(v.display_name_ar, :'q'),
         COALESCE(similarity(v.display_name_en, :'q'), 0),
         COALESCE((
           SELECT max(similarity(vn.name_normalized, :'q'))
           FROM village_name vn
           JOIN (SELECT id AS claim_id, village_id FROM claim
                 WHERE claim_type = 'VILLAGE_NAME' AND is_preferred) pn ON pn.claim_id = vn.claim_id
           WHERE pn.village_id = v.id), 0)) AS relevance,
       (SELECT count(*) FROM matched)::int AS total
FROM village v
JOIN matched m ON m.id = v.id
ORDER BY relevance DESC NULLS LAST, v.id
LIMIT 20 OFFSET 0;

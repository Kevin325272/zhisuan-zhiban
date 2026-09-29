DO $canonical_username_guard$
DECLARE
  collision_group_count bigint;
BEGIN
  SELECT COUNT(*)
    INTO collision_group_count
    FROM (
      SELECT lower(normalize(btrim(username), NFKC)) AS canonical_username
        FROM users
       WHERE username IS NOT NULL
       GROUP BY lower(normalize(btrim(username), NFKC))
      HAVING COUNT(*) > 1
    ) AS collisions;

  IF collision_group_count > 0 THEN
    RAISE EXCEPTION
      'Username canonicalization blocked by % collision group(s). Resolve them before retrying migration 036.',
      collision_group_count;
  END IF;
END
$canonical_username_guard$;

UPDATE users
   SET username = lower(normalize(btrim(username), NFKC))
 WHERE username IS NOT NULL
   AND username IS DISTINCT FROM lower(normalize(btrim(username), NFKC));

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_username_format_check;

ALTER TABLE users
  ADD CONSTRAINT users_username_format_check
  CHECK (
    username IS NULL
    OR (
      char_length(username) BETWEEN 1 AND 32
      AND username !~ '[[:space:][:cntrl:]]'
      AND username = lower(normalize(btrim(username), NFKC))
    )
  );

DROP INDEX IF EXISTS users_username_lower_idx;

CREATE UNIQUE INDEX users_username_canonical_idx
  ON users (username)
  WHERE username IS NOT NULL;

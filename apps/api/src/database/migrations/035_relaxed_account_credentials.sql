ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_username_format_check;

ALTER TABLE users
  ADD CONSTRAINT users_username_format_check
  CHECK (
    username IS NULL
    OR (
      char_length(username) BETWEEN 1 AND 32
      AND username !~ '[[:space:][:cntrl:]]'
    )
  );

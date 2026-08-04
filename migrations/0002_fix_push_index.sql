-- 0002_fix_push_index — toten Index ersetzen.
-- Die einzige Lookup-Query ist  WHERE lower(name) = lower(?)  (push.js, "Rekord
-- geschlagen"-Push). Der alte Plain-Index auf name konnte dafür nicht genutzt
-- werden (Full Scan). Ersatz durch einen Ausdrucks-Index auf lower(name).
DROP INDEX IF EXISTS idx_push_sub_name;
CREATE INDEX IF NOT EXISTS idx_push_sub_lname ON push_sub(lower(name));

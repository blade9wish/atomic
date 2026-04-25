-- Materialized Obsidian-style atom links extracted from atom markdown.

CREATE TABLE IF NOT EXISTS atom_links (
    id TEXT PRIMARY KEY,
    source_atom_id TEXT NOT NULL,
    target_atom_id TEXT,
    raw_target TEXT NOT NULL,
    label TEXT,
    target_kind TEXT NOT NULL,
    status TEXT NOT NULL,
    start_offset INTEGER,
    end_offset INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    db_id TEXT NOT NULL DEFAULT 'default'
);

CREATE INDEX IF NOT EXISTS idx_atom_links_source
    ON atom_links(db_id, source_atom_id, start_offset);
CREATE INDEX IF NOT EXISTS idx_atom_links_target
    ON atom_links(db_id, target_atom_id)
    WHERE target_atom_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_atom_links_status
    ON atom_links(db_id, status);

-- Best-effort historical backfill. Future writes use the Rust markdown scanner,
-- which skips code spans/fences and stores exact byte offsets.
INSERT INTO atom_links (
    id, source_atom_id, target_atom_id, raw_target, label,
    target_kind, status, start_offset, end_offset, created_at, updated_at, db_id
)
SELECT
    md5(a.db_id || ':' || a.id || ':' || m.ordinality::text) AS id,
    a.id AS source_atom_id,
    CASE
        WHEN btrim(m.parts[1]) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             AND target.id IS NOT NULL
        THEN target.id
        ELSE NULL
    END AS target_atom_id,
    btrim(m.parts[1]) AS raw_target,
    NULLIF(btrim(COALESCE(m.parts[2], '')), '') AS label,
    CASE
        WHEN btrim(m.parts[1]) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN 'atom_id'
        ELSE 'text'
    END AS target_kind,
    CASE
        WHEN btrim(m.parts[1]) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             AND target.id IS NOT NULL
        THEN 'resolved'
        WHEN btrim(m.parts[1]) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN 'missing'
        ELSE 'unresolved'
    END AS status,
    NULL AS start_offset,
    NULL AS end_offset,
    NOW()::text AS created_at,
    NOW()::text AS updated_at,
    a.db_id
FROM atoms a
CROSS JOIN LATERAL regexp_matches(
    a.content,
    '\[\[([^\]\|]+)(?:\|([^\]]+))?\]\]',
    'g'
) WITH ORDINALITY AS m(parts, ordinality)
LEFT JOIN atoms target
    ON target.id = btrim(m.parts[1])
   AND target.db_id = a.db_id
WHERE NOT EXISTS (
    SELECT 1
    FROM atom_links existing
    WHERE existing.source_atom_id = a.id
      AND existing.db_id = a.db_id
);

INSERT INTO schema_version (version) VALUES (9);

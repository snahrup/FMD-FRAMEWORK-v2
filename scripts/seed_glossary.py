"""Seed business_glossary and entity_annotations from IP Corp knowledge base.

Reads JSON files from the fabric_toolbox knowledge directory and imports
them idempotently into the FMD SQLite control plane DB.

Usage:
    python scripts/seed_glossary.py
    python scripts/seed_glossary.py --knowledge-path ~/CascadeProjects/fabric_toolbox/knowledge
    python scripts/seed_glossary.py --db-path dashboard/app/api/fmd_control_plane.db
"""

import argparse
import json
import logging
import sqlite3
import sys
from pathlib import Path

log = logging.getLogger("fmd.seed_glossary")

# ---------------------------------------------------------------------------
# Connection helper
# ---------------------------------------------------------------------------

def _get_conn(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


# ---------------------------------------------------------------------------
# JSON file loader — handles missing or non-JSON files gracefully
# ---------------------------------------------------------------------------

def _load_json(kb_path: Path, rel: str) -> dict | list | None:
    """Load a JSON file relative to kb_path, return None on any failure."""
    full = kb_path / rel
    if not full.exists():
        log.warning("Knowledge file not found, skipping: %s", full)
        return None
    try:
        with open(full, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except json.JSONDecodeError as exc:
        log.warning("Could not parse %s as JSON (%s), skipping", full, exc)
        return None
    except OSError as exc:
        log.warning("Could not read %s (%s), skipping", full, exc)
        return None


# ---------------------------------------------------------------------------
# Seeders
# ---------------------------------------------------------------------------

def seed_glossary_terms(conn: sqlite3.Connection, kb_path: Path) -> int:
    """Import entities/glossary.json → business_glossary.

    Returns the number of rows inserted/replaced.
    """
    data = _load_json(kb_path, "entities/glossary.json")
    if not data:
        return 0

    terms = data if isinstance(data, list) else data.get("terms", [])
    if not terms:
        log.warning("glossary.json: no 'terms' array found")
        return 0

    count = 0
    for item in terms:
        term = (item.get("term") or "").strip()
        definition = (item.get("definition") or "").strip()
        if not term or not definition:
            continue

        related = item.get("relatedSystems") or item.get("related_systems") or []
        synonyms = item.get("synonyms") or []
        category = (item.get("category") or "concept").strip()

        conn.execute(
            """
            INSERT INTO business_glossary
                (term, definition, category, related_systems, synonyms, source)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(term) DO UPDATE SET
                definition      = excluded.definition,
                category        = excluded.category,
                related_systems = excluded.related_systems,
                synonyms        = excluded.synonyms,
                source          = excluded.source
            """,
            (
                term,
                definition,
                category,
                json.dumps(related),
                json.dumps(synonyms),
                "knowledge-base:glossary",
            ),
        )
        count += 1

    log.info("seed_glossary_terms: upserted %d terms", count)
    return count


def seed_systems(conn: sqlite3.Connection, kb_path: Path) -> int:
    """Import entities/systems.json → business_glossary (category='system').

    Each system entry becomes a glossary term using its id as the term and
    description as the definition.  Returns the number of rows inserted/replaced.
    """
    data = _load_json(kb_path, "entities/systems.json")
    if not data:
        return 0

    systems = data if isinstance(data, list) else data.get("systems", [])
    if not systems:
        log.warning("systems.json: no 'systems' array found")
        return 0

    count = 0
    for item in systems:
        # Prefer the human-readable name as the glossary term
        term = (item.get("fullName") or item.get("name") or item.get("id") or "").strip()
        definition = (item.get("description") or "").strip()
        if not term:
            continue
        if not definition:
            definition = f"{item.get('category', 'System')} — {term}"

        category_val = (item.get("category") or "system").strip().lower()
        related = []  # systems don't have relatedSystems, they ARE the system
        synonyms = []
        if item.get("name") and item.get("name") != term:
            synonyms.append(item["name"])
        if item.get("id") and item.get("id") != term:
            synonyms.append(item["id"])

        conn.execute(
            """
            INSERT INTO business_glossary
                (term, definition, category, related_systems, synonyms, source)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(term) DO UPDATE SET
                definition      = excluded.definition,
                category        = excluded.category,
                related_systems = excluded.related_systems,
                synonyms        = excluded.synonyms,
                source          = excluded.source
            """,
            (
                term,
                definition,
                "system",
                json.dumps(related),
                json.dumps(synonyms),
                "knowledge-base:systems",
            ),
        )
        count += 1

    log.info("seed_systems: upserted %d system terms", count)
    return count


def seed_identifiers(conn: sqlite3.Connection, kb_path: Path) -> int:
    """Import entities/identifiers.json → business_glossary (category='identifier').

    Returns the number of rows inserted/replaced.
    """
    data = _load_json(kb_path, "entities/identifiers.json")
    if not data:
        return 0

    identifiers = data if isinstance(data, list) else data.get("identifiers", [])
    if not identifiers:
        log.warning("identifiers.json: no 'identifiers' array found")
        return 0

    count = 0
    for item in identifiers:
        term = (item.get("name") or "").strip()
        definition = (item.get("description") or "").strip()
        if not term or not definition:
            continue

        related = item.get("systems") or []
        synonyms = []
        if item.get("format"):
            synonyms.append(f"Format: {item['format']}")

        conn.execute(
            """
            INSERT INTO business_glossary
                (term, definition, category, related_systems, synonyms, source)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(term) DO UPDATE SET
                definition      = excluded.definition,
                category        = excluded.category,
                related_systems = excluded.related_systems,
                synonyms        = excluded.synonyms,
                source          = excluded.source
            """,
            (
                term,
                definition,
                "identifier",
                json.dumps(related),
                json.dumps(synonyms),
                "knowledge-base:identifiers",
            ),
        )
        count += 1

    log.info("seed_identifiers: upserted %d identifier terms", count)
    return count


def seed_entity_annotations(conn: sqlite3.Connection, kb_path: Path) -> int:
    """Import m3/mes table catalogs → entity_annotations, matched to lz_entities.

    Table names from the catalogs are normalized to UPPERCASE and matched
    case-insensitively against lz_entities.SourceName.  Only entities
    that exist in the DB are annotated.

    Returns the number of entity_annotations rows inserted/replaced.
    """
    # Load existing lz_entities (entity_id + SourceName)
    lz_rows = conn.execute(
        "SELECT LandingzoneEntityId, SourceName FROM lz_entities"
    ).fetchall()

    if not lz_rows:
        log.warning("seed_entity_annotations: lz_entities is empty, no annotations to create")
        return 0

    # Build lookup: UPPERCASE(SourceName) → LandingzoneEntityId
    lz_lookup: dict[str, int] = {}
    for row in lz_rows:
        src = (row["SourceName"] or "").strip().upper()
        if src:
            lz_lookup[src] = int(row["LandingzoneEntityId"])

    # Load catalogs
    catalog_files = [
        ("agents/m3-analyst/m3-table-catalog.json", "M3 ERP", "erp"),
        ("agents/mes-analyst/mes-table-catalog.json", "MES", "manufacturing"),
    ]

    count = 0
    for rel_path, source_label, default_domain in catalog_files:
        data = _load_json(kb_path, rel_path)
        if not data:
            continue

        # Catalogs are structured as {categories: {catName: {tables: [...]}}}
        categories = data.get("categories", {})
        if not isinstance(categories, dict):
            log.warning("%s: unexpected structure (no 'categories'), skipping", rel_path)
            continue

        for cat_name, cat_data in categories.items():
            if not isinstance(cat_data, dict):
                continue
            tables = cat_data.get("tables", [])
            if not isinstance(tables, list):
                continue

            domain = cat_data.get("domain") or default_domain

            for table_entry in tables:
                if not isinstance(table_entry, dict):
                    continue

                table_name = (table_entry.get("name") or "").strip()
                if not table_name:
                    continue

                # Match against lz_entities
                entity_id = lz_lookup.get(table_name.upper())
                if entity_id is None:
                    continue  # not registered in this deployment

                full_name = (table_entry.get("fullName") or "").strip()
                description = (table_entry.get("businessContext") or "").strip()
                if not description and table_entry.get("criticalFields"):
                    # Build a brief description from key fields
                    fields = list(table_entry["criticalFields"].keys())
                    description = f"Key fields: {', '.join(fields[:5])}"

                # Build tags from category name + importance
                tags: list[str] = [cat_name]
                if table_entry.get("verified"):
                    tags.append("verified")
                if table_entry.get("keyFields"):
                    tags.append("has-pks")

                conn.execute(
                    """
                    INSERT INTO entity_annotations
                        (entity_id, business_name, description, domain, tags, source)
                    VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT(entity_id) DO UPDATE SET
                        business_name = excluded.business_name,
                        description   = excluded.description,
                        domain        = excluded.domain,
                        tags          = excluded.tags,
                        source        = excluded.source
                    """,
                    (
                        entity_id,
                        full_name or table_name,
                        description,
                        domain,
                        json.dumps(tags),
                        f"knowledge-base:{source_label.lower().replace(' ', '-')}",
                    ),
                )
                count += 1

    log.info("seed_entity_annotations: upserted %d entity annotations", count)
    return count


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Seed business_glossary and entity_annotations from IP Corp knowledge base."
    )
    parser.add_argument(
        "--knowledge-path",
        default=str(Path.home() / "CascadeProjects" / "fabric_toolbox" / "knowledge"),
        help="Path to fabric_toolbox knowledge directory",
    )
    parser.add_argument(
        "--db-path",
        default=str(
            Path(__file__).parent.parent / "dashboard" / "app" / "api" / "fmd_control_plane.db"
        ),
        help="Path to FMD SQLite control plane DB",
    )
    parser.add_argument(
        "--verbose", "-v", action="store_true", help="Enable DEBUG logging"
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s  %(levelname)-8s  %(name)s — %(message)s",
        datefmt="%H:%M:%S",
    )

    kb_path = Path(args.knowledge_path).expanduser().resolve()
    db_path = Path(args.db_path).expanduser().resolve()

    if not kb_path.exists():
        log.error("Knowledge path does not exist: %s", kb_path)
        sys.exit(1)

    if not db_path.exists():
        log.error("DB file not found: %s", db_path)
        sys.exit(1)

    log.info("Knowledge path : %s", kb_path)
    log.info("DB path        : %s", db_path)

    conn = _get_conn(str(db_path))
    try:
        g = seed_glossary_terms(conn, kb_path)
        s = seed_systems(conn, kb_path)
        i = seed_identifiers(conn, kb_path)
        a = seed_entity_annotations(conn, kb_path)
        conn.commit()
        total = g + s + i + a
        log.info(
            "Done — glossary=%d  systems=%d  identifiers=%d  annotations=%d  (total=%d rows)",
            g, s, i, a, total,
        )
    except Exception:
        conn.rollback()
        log.exception("Seed failed — rolled back")
        sys.exit(1)
    finally:
        conn.close()


if __name__ == "__main__":
    main()

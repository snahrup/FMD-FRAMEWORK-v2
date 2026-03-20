# Project Standards

> **What**: Core technology stack, conventions, and patterns for the FMD Framework.
> **When to read**: At session start, before making architectural decisions or adding new code.

## Stack

| Layer | Technology |
|-------|-----------|
| Pipeline Engine | Python 3.11+, pyodbc, azure-identity, requests |
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui |
| Backend API | Python FastAPI, SQLite (control plane), SQL Analytics Endpoint |
| Infrastructure | Microsoft Fabric (Lakehouses, Notebooks, Pipelines, SQL Database) |
| Auth | Azure Service Principal (OAuth2, MSAL) |
| Deployment | `deploy_from_scratch.py` (17-phase automated provisioning) |

## Architecture

- **Medallion layers**: Landing Zone (raw parquet) -> Bronze (typed, partitioned) -> Silver (cleansed, SCD2) -> Gold (business views/MLVs)
- **Metadata-driven**: All pipeline behavior configured in SQL metadata database, no per-entity code
- **Entity model**: 1,666 entities across 5 sources, each registered across LZ + Bronze + Silver (4,998 registrations)
- **Path convention**: `{Namespace}/{Table}` in all layers, no exceptions

## Key Patterns

- **Config hierarchy**: `config/item_config.yaml` (GUIDs) > `dashboard/app/api/config.json` (runtime) > environment variables
- **Entity registration**: `register_entity()` auto-cascades to Bronze + Silver atomically
- **Dashboard routing**: Each page is a standalone `.tsx` file in `dashboard/app/src/pages/`
- **API routes**: FastAPI routers in `dashboard/app/api/routes/`, registered in main app
- **Engine modules**: Single-responsibility files (extractor.py, loader.py, orchestrator.py, models.py, preflight.py)
- **Stored procedures**: Defined in `engine/sql/` and deployed via NB_SETUP_FMD notebook
- **Entity digest**: `useEntityDigest` hook with module-level singleton cache (30s TTL)

## Conventions

- Source server hostnames: short form only (e.g., `m3-db1`, not `m3-db1.ipaper.com`)
- GUIDs: always from config, never hardcoded in source files
- SP auth scope: `analysis.windows.net/powerbi/api/.default`
- Commit messages: explain WHY, not just WHAT
- UI: must scale to N sources, never hardcode source count
- Operating modes: Diagnose -> Plan -> Implement -> Review (see `CLAUDE_RULES.md`)

## Learnings

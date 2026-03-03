"""
FMD v3 Engine — Preflight health checks.

Validates all dependencies before a run starts:
  1. SP tokens (Fabric SQL, Fabric API, OneLake)
  2. Fabric SQL metadata DB connectivity
  3. OneLake ADLS reachability
  4. Source SQL server connectivity (per unique server)
  5. Entity worklist sanity (counts, missing fields)

Run via:  orchestrator.preflight()  or  standalone:  python -m engine.preflight
"""

import logging
import time
from dataclasses import dataclass, field
from typing import List, Optional

from engine.auth import TokenProvider
from engine.connections import MetadataDB, SourceConnection
from engine.loader import OneLakeLoader
from engine.models import EngineConfig, Entity

log = logging.getLogger("fmd.preflight")


@dataclass
class CheckResult:
    """Result of a single preflight check."""
    name: str
    passed: bool
    message: str
    duration_ms: float = 0.0


@dataclass
class PreflightReport:
    """Full preflight report — all checks."""
    checks: List[CheckResult] = field(default_factory=list)
    passed: bool = True
    total_duration_ms: float = 0.0

    def add(self, check: CheckResult) -> None:
        self.checks.append(check)
        if not check.passed:
            self.passed = False
        self.total_duration_ms += check.duration_ms

    def to_dict(self) -> dict:
        return {
            "passed": self.passed,
            "all_passed": self.passed,
            "total_duration_ms": round(self.total_duration_ms, 1),
            "checks": [
                {
                    "name": c.name,
                    "passed": c.passed,
                    "message": c.message,
                    "duration_ms": round(c.duration_ms, 1),
                }
                for c in self.checks
            ],
        }

    def summary(self) -> str:
        """Human-readable summary line."""
        total = len(self.checks)
        passed = sum(1 for c in self.checks if c.passed)
        status = "PASS" if self.passed else "FAIL"
        return f"Preflight {status}: {passed}/{total} checks passed ({self.total_duration_ms:.0f}ms)"


class PreflightChecker:
    """Run all health checks and return a report.

    Usage::

        checker = PreflightChecker(config, token_provider, metadata_db, source_conn, loader)
        report = checker.run()
        if not report.passed:
            print(report.summary())
            for c in report.checks:
                if not c.passed:
                    print(f"  FAIL: {c.name} — {c.message}")
    """

    def __init__(
        self,
        config: EngineConfig,
        token_provider: TokenProvider,
        metadata_db: MetadataDB,
        source_conn: SourceConnection,
        loader: OneLakeLoader,
    ):
        self._config = config
        self._token_provider = token_provider
        self._metadata_db = metadata_db
        self._source_conn = source_conn
        self._loader = loader

    def run(self, entities: Optional[List[Entity]] = None) -> PreflightReport:
        """Run all preflight checks and return a report."""
        report = PreflightReport()

        report.add(self._check_tokens())
        report.add(self._check_metadata_db())
        report.add(self._check_onelake())

        if entities:
            report.add(self._check_entity_sanity(entities))

            # Check each unique source server
            sources = set()
            for e in entities:
                sources.add((e.source_server, e.source_database))
            for server, database in sorted(sources):
                report.add(self._check_source_server(server, database))

        log.info(report.summary())
        return report

    # ------------------------------------------------------------------
    # Individual checks
    # ------------------------------------------------------------------

    def _check_tokens(self) -> CheckResult:
        """Validate all three SP token scopes."""
        t0 = time.perf_counter()
        try:
            results = self._token_provider.validate()
            elapsed_ms = (time.perf_counter() - t0) * 1000
            all_ok = all(results.values())
            failures = [k for k, v in results.items() if not v]
            if all_ok:
                return CheckResult(
                    name="sp_tokens",
                    passed=True,
                    message="All 3 token scopes valid (SQL, API, OneLake)",
                    duration_ms=elapsed_ms,
                )
            else:
                return CheckResult(
                    name="sp_tokens",
                    passed=False,
                    message=f"Token failures: {', '.join(failures)}. Check tenant/client/secret.",
                    duration_ms=elapsed_ms,
                )
        except Exception as exc:
            elapsed_ms = (time.perf_counter() - t0) * 1000
            return CheckResult(
                name="sp_tokens",
                passed=False,
                message=f"Token validation error: {exc}",
                duration_ms=elapsed_ms,
            )

    def _check_metadata_db(self) -> CheckResult:
        """Ping the Fabric SQL metadata DB."""
        t0 = time.perf_counter()
        ok = self._metadata_db.ping()
        elapsed_ms = (time.perf_counter() - t0) * 1000
        if ok:
            return CheckResult(
                name="metadata_db",
                passed=True,
                message=f"Connected to Fabric SQL ({self._config.sql_database.split('-')[0]})",
                duration_ms=elapsed_ms,
            )
        return CheckResult(
            name="metadata_db",
            passed=False,
            message=(
                f"Cannot connect to Fabric SQL ({self._config.sql_database.split('-')[0]}). "
                "Check SP token and network access."
            ),
            duration_ms=elapsed_ms,
        )

    def _check_onelake(self) -> CheckResult:
        """Ping OneLake ADLS endpoint."""
        t0 = time.perf_counter()
        ok = self._loader.ping()
        elapsed_ms = (time.perf_counter() - t0) * 1000
        if ok:
            return CheckResult(
                name="onelake",
                passed=True,
                message="OneLake ADLS endpoint reachable",
                duration_ms=elapsed_ms,
            )
        return CheckResult(
            name="onelake",
            passed=False,
            message=(
                "Cannot reach OneLake. Check SP has Contributor role on the DATA workspace "
                "and the workspace_data_id is correct."
            ),
            duration_ms=elapsed_ms,
        )

    def _check_source_server(self, server: str, database: str) -> CheckResult:
        """Ping a source SQL server."""
        t0 = time.perf_counter()
        ok = self._source_conn.ping(server, database)
        elapsed_ms = (time.perf_counter() - t0) * 1000
        if ok:
            return CheckResult(
                name=f"source_{server}_{database}",
                passed=True,
                message=f"Connected to {server}/{database}",
                duration_ms=elapsed_ms,
            )
        return CheckResult(
            name=f"source_{server}_{database}",
            passed=False,
            message=(
                f"Cannot connect to {server}/{database}. "
                "Check VPN connection and that the server is accessible."
            ),
            duration_ms=elapsed_ms,
        )

    def _check_entity_sanity(self, entities: List[Entity]) -> CheckResult:
        """Validate the entity worklist for common problems."""
        t0 = time.perf_counter()
        issues: list[str] = []

        if not entities:
            elapsed_ms = (time.perf_counter() - t0) * 1000
            return CheckResult(
                name="entity_sanity",
                passed=False,
                message="Entity worklist is empty — nothing to process.",
                duration_ms=elapsed_ms,
            )

        # Check for blank SourceName (the #1 cause of v2 failures)
        blank_names = [e for e in entities if not e.source_name.strip()]
        if blank_names:
            issues.append(f"{len(blank_names)} entities have blank SourceName")

        # Check for missing server/database
        no_server = [e for e in entities if not e.source_server]
        if no_server:
            issues.append(f"{len(no_server)} entities have no source_server")

        # Check for inactive entities in the worklist
        inactive = [e for e in entities if not e.is_active]
        if inactive:
            issues.append(f"{len(inactive)} inactive entities in worklist (will be filtered)")

        # Summary stats
        incremental = sum(1 for e in entities if e.is_incremental)
        full_load = len(entities) - incremental

        elapsed_ms = (time.perf_counter() - t0) * 1000

        if issues:
            return CheckResult(
                name="entity_sanity",
                passed=False,
                message=f"{len(entities)} entities ({incremental} incremental, {full_load} full). Issues: {'; '.join(issues)}",
                duration_ms=elapsed_ms,
            )

        return CheckResult(
            name="entity_sanity",
            passed=True,
            message=f"{len(entities)} entities ready ({incremental} incremental, {full_load} full load)",
            duration_ms=elapsed_ms,
        )

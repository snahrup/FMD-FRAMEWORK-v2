"""
FMD v3 Engine — Preflight health checks.

Validates all dependencies before a run starts:
  1. SP tokens (Fabric API, OneLake)
  2. SQLite control-plane DB readability
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
from engine.connections import SourceConnection
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

        checker = PreflightChecker(config, token_provider, source_conn, loader)
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
        source_conn: SourceConnection,
        loader: OneLakeLoader,
    ):
        self._config = config
        self._token_provider = token_provider
        self._source_conn = source_conn
        self._loader = loader

    def run(self, entities: Optional[List[Entity]] = None) -> PreflightReport:
        """Run all preflight checks and return a report."""
        report = PreflightReport()

        report.add(self._check_tokens())
        report.add(self._check_metadata_db())
        report.add(self._check_onelake())

        if entities is not None:
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
                    name="Service Principal Tokens",
                    passed=True,
                    message="All 3 token scopes valid",
                    duration_ms=elapsed_ms,
                )
            else:
                return CheckResult(
                    name="Service Principal Tokens",
                    passed=False,
                    message=f"Token failures: {', '.join(failures)}",
                    duration_ms=elapsed_ms,
                )
        except Exception as exc:
            elapsed_ms = (time.perf_counter() - t0) * 1000
            return CheckResult(
                name="Service Principal Tokens",
                passed=False,
                message=f"Validation error: {exc}",
                duration_ms=elapsed_ms,
            )

    def _check_metadata_db(self) -> CheckResult:
        """Verify the local SQLite control-plane DB is readable."""
        t0 = time.perf_counter()
        try:
            from dashboard.app.api import db as fmd_db
            rows = fmd_db.query("SELECT COUNT(*) AS cnt FROM lz_entities WHERE IsActive = 1")
            cnt = dict(rows[0])["cnt"] if rows else 0
            elapsed_ms = (time.perf_counter() - t0) * 1000
            return CheckResult(
                name="SQLite Control-Plane DB",
                passed=True,
                message=f"Readable — {cnt} active entities",
                duration_ms=elapsed_ms,
            )
        except Exception as exc:
            elapsed_ms = (time.perf_counter() - t0) * 1000
            return CheckResult(
                name="SQLite Control-Plane DB",
                passed=False,
                message=f"Cannot read — {exc}",
                duration_ms=elapsed_ms,
            )

    def _check_onelake(self) -> CheckResult:
        """Ping OneLake ADLS endpoint."""
        t0 = time.perf_counter()
        ok = self._loader.ping()
        elapsed_ms = (time.perf_counter() - t0) * 1000
        if ok:
            return CheckResult(
                name="OneLake Storage",
                passed=True,
                message="Reachable",
                duration_ms=elapsed_ms,
            )
        return CheckResult(
            name="OneLake Storage",
            passed=False,
            message="Cannot reach OneLake — check SP permissions on DATA workspace",
            duration_ms=elapsed_ms,
        )

    def _check_source_server(self, server: str, database: str) -> CheckResult:
        """Ping a source SQL server."""
        t0 = time.perf_counter()
        ok = self._source_conn.ping(server, database)
        elapsed_ms = (time.perf_counter() - t0) * 1000
        if ok:
            return CheckResult(
                name=f"Source: {server}/{database}",
                passed=True,
                message="Connected",
                duration_ms=elapsed_ms,
            )
        return CheckResult(
            name=f"Source: {server}/{database}",
            passed=False,
            message="Cannot connect — check VPN",
            duration_ms=elapsed_ms,
        )

    def _check_entity_sanity(self, entities: List[Entity]) -> CheckResult:
        """Validate the entity worklist for common problems."""
        t0 = time.perf_counter()
        issues: list[str] = []

        if not entities:
            elapsed_ms = (time.perf_counter() - t0) * 1000
            return CheckResult(
                name="Entity Worklist",
                passed=False,
                message="Empty — nothing to process",
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
                name="Entity Worklist",
                passed=False,
                message=f"{len(entities)} entities ({incremental} incremental, {full_load} full). Issues: {'; '.join(issues)}",
                duration_ms=elapsed_ms,
            )

        return CheckResult(
            name="Entity Worklist",
            passed=True,
            message=f"{len(entities)} entities ({incremental} incremental, {full_load} full)",
            duration_ms=elapsed_ms,
        )

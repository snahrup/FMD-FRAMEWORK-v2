# Technical Debt Register

| # | Debt Item | Severity | Impact | Owns | Status |
|---|-----------|----------|--------|------|--------|
| 1 | **Zero test coverage on API endpoints** | HIGH | Any change to server.py risks silent breakage | QA Engineer | OPEN |
| 2 | **server.py is 11K LOC monolith** | HIGH | Hard to reason about, merge conflicts likely | API Lead | OPEN |
| 3 | **44 dashboard pages, many incomplete** | MEDIUM | Users see broken/stub pages | Frontend Lead | OPEN |
| 4 | **Stale mock data in dashboard pages** | MEDIUM | Misleading UI, erodes trust | Frontend Lead | OPEN |
| 5 | **Load optimization not persisting to DB** | HIGH | SourceManager shows wrong load types | API Lead + Fabric Engineer | OPEN |
| 6 | **158 scripts in scripts/ with no organization** | LOW | Hard to find the right script | DevOps Lead | OPEN |
| 7 | **engine/tests/ has only test_models.py** | HIGH | Engine changes are untested | QA Engineer | OPEN |
| 8 | **No CI/CD pipeline** | MEDIUM | Manual deployment only | DevOps Lead | OPEN |
| 9 | **SQL Analytics Endpoint sync lag not handled** | HIGH | Phantom bugs, wrong query results | Fabric Engineer | OPEN |
| 10 | **InvokePipeline SP auth workaround fragile** | MEDIUM | REST API orchestrator is custom, not native | Fabric Engineer | OPEN |

# RP-06C: Connectivity Verification + Targeted Extraction Re-Test

> Pre-rerun verification before full engine extraction.
> Date: 2026-03-22

---

## Step 1: Remediation Executed

**Status: COMPLETE**

`scripts/remediate_watermarks.py` ran successfully against `fmd_control_plane.db`:

| Action | Count | Result |
|--------|-------|--------|
| Bad watermark entries deleted | 255 | All entries with seed value `2026-03-17T04:25:48Z` removed |
| Phantom entities deactivated | 3 | Entities 597, 1725, 1727 (`ipc_CSS_INVT_LOT_MASTER_2`) set to IsActive=0 |

**Post-remediation verification:**
- Bad watermarks remaining: **0**
- Legitimate watermarks surviving: **7** (real values: integers and actual datetimes)
- Phantom entity `ipc_CSS_INVT_LOT_MASTER_2`: **all 4 registrations inactive**
- Non-`_2` variant `ipc_CSS_INVT_LOT_MASTER` (entity 705): **remains active** (different table)

---

## Step 2: VPN/Connectivity Check

**Status: COMPLETE — all 5 sources reachable**

| Source | Server | Port | Status |
|--------|--------|------|--------|
| M3 ERP | sqllogshipprd | 1433 | REACHABLE |
| MES | m3-db1 | 1433 | REACHABLE |
| OPTIVA | SQLOptivaLive | 1433 | REACHABLE |
| M3 Cloud | sql2016live | 1433 | REACHABLE |
| ETQ | M3-DB3 | 1433 | REACHABLE |

---

## Step 3: Targeted Extraction Re-Test (1 entity per source)

**Status: COMPLETE — all 5 sources extract successfully**

| Source | Server/DB | Table | Rows | Columns | Status |
|--------|-----------|-------|------|---------|--------|
| M3 ERP | sqllogshipprd/m3fdbprd | FATJDTA.AUDFIL | 5 | 12 | SUCCEEDED |
| MES | m3-db1/mes | dbo.aaa_batchaudit_tbl | 5 | 10 | SUCCEEDED |
| OPTIVA | SQLOptivaLive/OptivaLive | dbo.C_VENDOR_TRADENAME | 1 | 6 | SUCCEEDED |
| M3 Cloud | sql2016live/DI_PRD_Staging | dbo.CAEXEL | 5 | 41 | SUCCEEDED |
| ETQ | M3-DB3/ETQStagingPRD | dbo.Customers | 5 | 19 | SUCCEEDED |

---

## Step 4: Confirm No Watermark Type Mismatch Recurrence

**Status: VERIFIED**

- All 255 bad watermark entries deleted — no timestamp-on-integer mismatches remain
- Previously-failing entity 599 (`alel_lab_batch_hdr_tbl`, watermark col `lab_record_id`):
  - Watermark after remediation: **None** (will full-load)
  - Full-load query (no WHERE clause): **3 rows, 12 cols — OK**
  - `MAX(lab_record_id)` = **5** (int) — engine will correctly seed this value
- Seed script hardened — will not write timestamps to integer columns if re-run

---

## Step 5: Confirm No Phantom-Entity Failures

**Status: VERIFIED**

- Entity 597: `ipc_CSS_INVT_LOT_MASTER_2` — **IsActive=0**
- Entity 1667: `ipc_CSS_INVT_LOT_MASTER_2` — **IsActive=0** (was already inactive)
- Entity 1725: `ipc_CSS_INVT_LOT_MASTER_2` — **IsActive=0**
- Entity 1727: ` ipc_CSS_INVT_LOT_MASTER_2` (space typo) — **IsActive=0**
- Entity 705: `ipc_CSS_INVT_LOT_MASTER` (different table, no `_2`) — **IsActive=1** (correct)

---

## Verdict

**All pre-conditions for a full rerun are met.**

| Step | Status |
|------|--------|
| 1. Remediation | COMPLETE |
| 2. VPN connectivity | COMPLETE — all 5 reachable |
| 3. Test extraction | COMPLETE — all 5 succeed |
| 4. Watermark mismatch prevention | VERIFIED |
| 5. Phantom entity prevention | VERIFIED |

**Safe to run full engine extraction.**

Note: The local `fmd_control_plane.db` has been remediated. If `vsc-fabric` has its own copy of this database, `remediate_watermarks.py` should be run there too before triggering the engine.

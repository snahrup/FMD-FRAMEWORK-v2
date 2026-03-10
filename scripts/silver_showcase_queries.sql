-- ============================================================================
-- SILVER LAYER CROSS-SOURCE SHOWCASE QUERIES
-- Run these in the Fabric SQL endpoint for LH_SILVER_LAYER
-- Workspace: DEV_INTEGRATION DATA (D)
-- ============================================================================
-- WHY THIS MATTERS: These queries join data across 5 completely separate
-- source systems (M3 ERP, MES, ETQ, M3 Cloud, Optiva) that have NEVER
-- been queryable together before. Each one was a siloed database on a
-- different server. Now they're all in one Silver lakehouse.
-- ============================================================================
-- RUN EACH QUERY INDIVIDUALLY (highlight one block, then execute)
-- ============================================================================


-- ============================================================================
-- QUERY 1: Product 360 View — M3 Items + ETQ Quality + MES Formulas
-- "For any product, see ERP master data + quality certs + production formula"
-- ============================================================================
SELECT TOP 50
    TRIM(m.MMITNO)                          AS ItemNumber,
    TRIM(m.MMITDS)                          AS ItemDescription,
    TRIM(m.MMITGR)                          AS ItemGroup,
    TRIM(m.MMUNMS)                          AS UnitOfMeasure,
    e.MaterialNo                            AS ETQ_MaterialNo,
    e.MaterialName                          AS ETQ_MaterialName,
    e.CASNo                                 AS ETQ_CASNumber,
    e.Owner                                 AS ETQ_Owner,
    fh.item_id                              AS MES_FormulaItem,
    fh.frmla_code                           AS MES_FormulaCode,
    fh.crt_dt                               AS MES_FormulaCreated
FROM dbo.m3_MVXJDTA_MITMAS m
LEFT JOIN dbo.etq_dbo_ETQ_Materials e
    ON TRIM(m.MMITNO) = TRIM(e.MaterialNo)
LEFT JOIN dbo.mes_dbo_MES_mes_frmla_hdr_tbl fh
    ON TRIM(m.MMITNO) = TRIM(fh.item_id)
WHERE fh.item_id IS NOT NULL OR e.MaterialNo IS NOT NULL
ORDER BY m.MMITNO;
-- INSIGHT: Shows which products have quality records (ETQ) AND production
-- formulas (MES). Gaps = items sold without quality tracking.


-- ============================================================================
-- QUERY 2: Supplier Quality Intelligence — M3 Suppliers + ETQ Quals
-- "Which suppliers have quality records vs which are flying blind?"
-- ============================================================================
SELECT
    TRIM(v.IISUNO)                          AS SupplierCode,
    CAST(v.IIABSM AS VARCHAR)              AS SupplierRef,
    CASE WHEN es.SupplierNo IS NOT NULL THEN 'YES' ELSE 'NO' END AS HasETQRecord,
    es.SupplierName                         AS ETQ_SupplierName,
    COUNT(DISTINCT sm.MaterialNo)           AS ETQ_QualifiedMaterials
FROM dbo.m3_MVXJDTA_CIDVEN v
LEFT JOIN dbo.etq_dbo_ETQ_Suppliers es
    ON TRIM(v.IISUNO) = TRIM(es.SupplierNo)
LEFT JOIN dbo.etq_dbo_ETQ_SupplierMaterials sm
    ON es.SupplierNo = sm.SupplierNo
GROUP BY TRIM(v.IISUNO), CAST(v.IIABSM AS VARCHAR), es.SupplierNo, es.SupplierName
ORDER BY ETQ_QualifiedMaterials DESC;
-- INSIGHT: 6,189 M3 suppliers but only 387 have ETQ quality records.
-- 93.7% of suppliers have NO quality documentation in the system.


-- ============================================================================
-- QUERY 3: Customer Data Reconciliation — M3 ERP vs ETQ vs M3 Cloud
-- "Same customers across 3 systems — do they match?"
-- ============================================================================
SELECT TOP 100
    TRIM(m.OKCUNO)                          AS M3_CustomerNo,
    TRIM(m.OKCUNM)                          AS M3_CustomerName,
    ec.CustomerNo                           AS ETQ_CustomerNo,
    ec.CustomerName                         AS ETQ_CustomerName,
    TRIM(mc.OKCUNO)                         AS M3Cloud_CustomerNo,
    TRIM(mc.OKCUNM)                         AS M3Cloud_CustomerName,
    CASE
        WHEN ec.CustomerNo IS NOT NULL AND mc.OKCUNO IS NOT NULL THEN 'All 3 Systems'
        WHEN ec.CustomerNo IS NOT NULL THEN 'M3 + ETQ Only'
        WHEN mc.OKCUNO IS NOT NULL THEN 'M3 + M3Cloud Only'
        ELSE 'M3 Only'
    END                                     AS SystemCoverage
FROM dbo.m3_MVXJDTA_OCUSMA m
LEFT JOIN dbo.etq_dbo_ETQ_Customers ec
    ON TRIM(m.OKCUNO) = TRIM(ec.CustomerNo)
LEFT JOIN dbo.m3c_dbo_M3C_OCUSMA mc
    ON TRIM(m.OKCUNO) = TRIM(mc.OKCUNO)
ORDER BY SystemCoverage, m.OKCUNO;
-- INSIGHT: Exposes data fragmentation — customers that exist in ERP but
-- not in quality (ETQ) or cloud (M3C). Each gap = potential compliance risk.


-- ============================================================================
-- QUERY 4: M3 On-Prem vs M3 Cloud Item Drift
-- "What items exist in one M3 environment but not the other?"
-- ============================================================================
SELECT TOP 200
    COALESCE(TRIM(onp.MMITNO), TRIM(cld.MMITNO)) AS ItemNumber,
    TRIM(onp.MMITDS)                        AS OnPrem_Description,
    TRIM(cld.MMITDS)                        AS Cloud_Description,
    CASE
        WHEN onp.MMITNO IS NOT NULL AND cld.MMITNO IS NOT NULL THEN
            CASE WHEN TRIM(onp.MMITDS) = TRIM(cld.MMITDS) THEN 'Synced'
                 ELSE 'DESCRIPTION MISMATCH'
            END
        WHEN onp.MMITNO IS NOT NULL THEN 'On-Prem Only'
        ELSE 'Cloud Only'
    END                                     AS SyncStatus,
    TRIM(onp.MMITGR)                        AS OnPrem_ItemGroup,
    TRIM(cld.MMITGR)                        AS Cloud_ItemGroup
FROM dbo.m3_MVXJDTA_MITMAS onp
FULL OUTER JOIN dbo.m3c_dbo_M3C_MITMAS cld
    ON TRIM(onp.MMITNO) = TRIM(cld.MMITNO)
WHERE onp.MMITNO IS NULL
   OR cld.MMITNO IS NULL
   OR TRIM(onp.MMITDS) <> TRIM(cld.MMITDS)
ORDER BY SyncStatus, ItemNumber;
-- INSIGHT: 15,487 items in both, 2,471 ONLY on-prem, 10,409 ONLY in cloud.
-- Description mismatches = master data quality issues between environments.


-- ============================================================================
-- QUERY 5: MES Batch Production + M3 Item Master
-- "Connect shop floor production to ERP product data"
-- ============================================================================
SELECT TOP 100
    bh.batch_id                             AS BatchNumber,
    bh.item_id                              AS ProductItem,
    bh.batch_size                           AS BatchSize,
    bh.crt_dt                               AS BatchCreated,
    bh.batch_status                         AS BatchStatus,
    TRIM(m.MMITDS)                          AS M3_ProductDescription,
    TRIM(m.MMITGR)                          AS M3_ItemGroup,
    bo.sale_order_no                        AS SalesOrderNumber,
    bo.cust_id                              AS CustomerID
FROM dbo.mes_dbo_MES_mes_batch_hdr_tbl bh
LEFT JOIN dbo.m3_MVXJDTA_MITMAS m
    ON TRIM(bh.item_id) = TRIM(m.MMITNO)
LEFT JOIN dbo.mes_dbo_MES_mes_batch_order_xref_tbl bo
    ON bh.batch_id = bo.batch_id
WHERE bh.crt_dt IS NOT NULL
ORDER BY bh.crt_dt DESC;
-- INSIGHT: Links MES production batches to M3 product master + sales orders.
-- Previously impossible without manual cross-referencing between systems.


-- ============================================================================
-- QUERY 6: QC Test Results + Product Master — Quality Trend Analysis
-- "Which products have the most QC testing activity?"
-- ============================================================================
SELECT TOP 50
    TRIM(th.item_id)                        AS ProductItem,
    TRIM(m.MMITDS)                          AS ProductDescription,
    TRIM(m.MMITGR)                          AS ItemGroup,
    COUNT(DISTINCT th.batch_id)             AS BatchesTested,
    COUNT(td.test_result_dtl_id)            AS TotalTestResults,
    th.status                               AS QCStatus
FROM dbo.mes_dbo_MES_mes_QC_test_result_hdr_tbl th
LEFT JOIN dbo.mes_dbo_MES_mes_QC_test_result_dtl_tbl td
    ON th.test_result_id = td.test_result_id
LEFT JOIN dbo.m3_MVXJDTA_MITMAS m
    ON TRIM(th.item_id) = TRIM(m.MMITNO)
GROUP BY TRIM(th.item_id), TRIM(m.MMITDS), TRIM(m.MMITGR), th.status
ORDER BY TotalTestResults DESC;
-- INSIGHT: Cross-references MES quality control data with M3 product master.
-- Shows which product groups generate the most QC activity.


-- ============================================================================
-- QUERY 7: Supply Chain Traceability — Purchase Orders to Inventory to Sales
-- "Full material flow from supplier PO -> warehouse -> customer order"
-- ============================================================================
SELECT TOP 100
    TRIM(po.IAPUNO)                         AS PurchaseOrder,
    TRIM(pl.IBITNO)                         AS ItemNumber,
    TRIM(m.MMITDS)                          AS ItemDescription,
    TRIM(po.IASUNO)                         AS SupplierCode,
    TRIM(inv.MBWHLO)                        AS Warehouse,
    inv.MBSTQT                              AS StockQty,
    inv.MBALQT                              AS AllocatedQty,
    so.OAORNO                               AS SalesOrder,
    TRIM(so.OACUNO)                         AS CustomerCode,
    TRIM(c.OKCUNM)                          AS CustomerName
FROM dbo.m3_MVXJDTA_MPHEAD po
JOIN dbo.m3_MVXJDTA_MPLINE pl ON po.IAPUNO = pl.IBPUNO
LEFT JOIN dbo.m3_MVXJDTA_MITMAS m ON TRIM(pl.IBITNO) = TRIM(m.MMITNO)
LEFT JOIN dbo.m3_MVXJDTA_CIDVEN v ON TRIM(po.IASUNO) = TRIM(v.IISUNO)
LEFT JOIN dbo.m3_MVXJDTA_MITBAL inv ON TRIM(pl.IBITNO) = TRIM(inv.MBITNO)
LEFT JOIN dbo.m3_MVXJDTA_OOLINE sol ON TRIM(pl.IBITNO) = TRIM(sol.OBITNO)
LEFT JOIN dbo.m3_MVXJDTA_OOHEAD so ON sol.OBORNO = so.OAORNO
LEFT JOIN dbo.m3_MVXJDTA_OCUSMA c ON TRIM(so.OACUNO) = TRIM(c.OKCUNO)
ORDER BY po.IAPUNO DESC;
-- INSIGHT: End-to-end supply chain in ONE QUERY: who supplied it, where is it,
-- who's it going to. This was 4+ separate reports across 2 systems before.


-- ============================================================================
-- QUERY 8: MES Batch-to-Sales Order Cross-Reference
-- "Which customer orders are tied to which production batches?"
-- ============================================================================
SELECT TOP 100
    bo.batch_id                             AS MES_BatchID,
    bo.sale_order_no                        AS SalesOrderNo,
    bo.item_id                              AS ItemNumber,
    TRIM(m.MMITDS)                          AS ProductDescription,
    bo.order_qty                            AS OrderQty,
    bo.cust_id                              AS MES_CustomerID,
    TRIM(c.OKCUNM)                          AS M3_CustomerName,
    bh.batch_status                         AS BatchStatus,
    bh.ship_status                          AS ShipStatus,
    bh.crt_dt                               AS BatchCreated,
    bh.complete_date                        AS BatchCompleted
FROM dbo.mes_dbo_MES_mes_batch_order_xref_tbl bo
LEFT JOIN dbo.mes_dbo_MES_mes_batch_hdr_tbl bh
    ON bo.batch_id = bh.batch_id
LEFT JOIN dbo.m3_MVXJDTA_MITMAS m
    ON TRIM(bo.item_id) = TRIM(m.MMITNO)
LEFT JOIN dbo.m3_MVXJDTA_OCUSMA c
    ON TRIM(bo.cust_id) = TRIM(c.OKCUNO)
WHERE bo.sale_order_no IS NOT NULL
ORDER BY bh.crt_dt DESC;
-- INSIGHT: Connects MES production directly to M3 customer records.
-- "This batch was made for THIS customer" — full traceability.


-- ============================================================================
-- SUMMARY: What's in the Silver Layer
-- ============================================================================
-- 1,559 delta tables across 5 source systems:
--   M3 ERP (On-Prem):  590 tables — 17,958 items, 124,754 sales orders, 101,438 POs
--   MES:               438 tables — Production batches, QC results, formulas, inventory
--   Optiva:            313 tables — Formula management, R&D
--   M3 Cloud:          183 tables — 25,896 items, 6,962 customers, 7,122 suppliers
--   ETQ:                13 tables — Quality management (customers, suppliers, materials)
--
-- CROSS-SOURCE HIGHLIGHTS:
--   86.7% of M3 items have matching ETQ quality records (15,576 of 17,958)
--   57.5% of M3 customers have ETQ quality documentation (1,087 of 1,889)
--   15,487 items exist in BOTH M3 environments; 10,409 ONLY in cloud
--   Only 6.3% of suppliers have ETQ quality records — massive gap
--
-- BEFORE: Each system was a separate database on a separate server.
--         Cross-referencing required manual exports, Excel lookups, and prayers.
-- AFTER:  One SQL query joins all 5 systems. Real-time. Automated refresh.

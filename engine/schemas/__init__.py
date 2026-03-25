"""
FMD Schema Registry — maps source.table names to Pandera schema classes.

Usage:
    from engine.schemas import SCHEMA_REGISTRY
    schema_cls = SCHEMA_REGISTRY.get("m3fdbprd.MITMAS")
    if schema_cls:
        schema_cls.validate(df)
"""

import logging
from typing import Optional

log = logging.getLogger("fmd.schemas")

# Registry: "database.table" → Pandera DataFrameModel class
# Tables not in this registry pass validation with a warning (no blocking).
SCHEMA_REGISTRY: dict[str, type] = {}


def _register_schemas() -> None:
    """Populate the registry from schema modules. Safe to import — catches errors."""
    try:
        from engine.schemas.m3_schemas import (
            MitmasSchema, OolineSchema, CidmasSchema, MilomaSchema, MplineSchema,
        )
        SCHEMA_REGISTRY.update({
            "m3fdbprd.MITMAS": MitmasSchema,
            "m3fdbprd.OOLINE": OolineSchema,
            "m3fdbprd.CIDMAS": CidmasSchema,
            "m3fdbprd.MILOMA": MilomaSchema,
            "m3fdbprd.MPLINE": MplineSchema,
        })
    except Exception as e:
        log.warning("Failed to load M3 schemas: %s", e)

    try:
        from engine.schemas.mes_schemas import WorkOrderSchema, ProductionDataSchema
        SCHEMA_REGISTRY.update({
            "mes.WorkOrder": WorkOrderSchema,
            "mes.ProductionData": ProductionDataSchema,
        })
    except Exception as e:
        log.warning("Failed to load MES schemas: %s", e)


def get_schema(database: str, table: str) -> Optional[type]:
    """Look up a Pandera schema for the given database.table.

    Returns None if no schema is registered (table will pass validation with a warning).
    """
    if not SCHEMA_REGISTRY:
        _register_schemas()
    return SCHEMA_REGISTRY.get(f"{database}.{table}")

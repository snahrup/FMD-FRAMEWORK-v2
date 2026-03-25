"""
Pandera schemas for M3 ERP tables (top loaded tables).

Start with the most critical / frequently loaded tables.
Expand coverage over time by adding more schema classes.
"""

from typing import Optional

import pandera.polars as pa
import polars as pl

from engine.schemas.base import FmdBaseSchema


class MitmasSchema(FmdBaseSchema):
    """M3 Item Master (MITMAS) — core item/product reference."""
    MMCONO: int = pa.Field(ge=1, description="Company number")
    MMITNO: str = pa.Field(str_length={"min_value": 1}, description="Item number (PK)")
    MMITDS: Optional[str] = pa.Field(nullable=True, description="Item description")
    MMSTAT: Optional[str] = pa.Field(nullable=True, description="Status")
    MMITTY: Optional[str] = pa.Field(nullable=True, description="Item type")


class OolineSchema(FmdBaseSchema):
    """M3 Customer Order Lines (OOLINE) — sales order line items."""
    OBCONO: int = pa.Field(ge=1, description="Company number")
    OBORNO: str = pa.Field(str_length={"min_value": 1}, description="Order number")
    OBPONR: int = pa.Field(ge=0, description="Line number")
    OBITNO: Optional[str] = pa.Field(nullable=True, description="Item number")
    OBORQA: Optional[float] = pa.Field(nullable=True, description="Ordered quantity")


class CidmasSchema(FmdBaseSchema):
    """M3 Customer Master (CIDMAS) — customer reference data."""
    OKCONO: int = pa.Field(ge=1, description="Company number")
    OKCUNO: str = pa.Field(str_length={"min_value": 1}, description="Customer number (PK)")
    OKCUNM: Optional[str] = pa.Field(nullable=True, description="Customer name")
    OKSTAT: Optional[str] = pa.Field(nullable=True, description="Status")


class MilomaSchema(FmdBaseSchema):
    """M3 Item Warehouse (MILOMA) — item location/warehouse data."""
    MLCONO: int = pa.Field(ge=1, description="Company number")
    MLITNO: str = pa.Field(str_length={"min_value": 1}, description="Item number")
    MLWHLO: str = pa.Field(str_length={"min_value": 1}, description="Warehouse")


class MplineSchema(FmdBaseSchema):
    """M3 Purchase Order Lines (MPLINE) — procurement line items."""
    IBCONO: int = pa.Field(ge=1, description="Company number")
    IBPUNO: str = pa.Field(str_length={"min_value": 1}, description="PO number")
    IBPNLI: int = pa.Field(ge=0, description="Line number")
    IBITNO: Optional[str] = pa.Field(nullable=True, description="Item number")

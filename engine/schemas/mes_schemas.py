"""
Pandera schemas for MES tables (manufacturing execution system).

Start with the most critical / frequently loaded tables.
"""

from typing import Optional

import pandera.polars as pa

from engine.schemas.base import FmdBaseSchema


class WorkOrderSchema(FmdBaseSchema):
    """MES Work Order — production work orders."""
    WorkOrderID: int = pa.Field(ge=1, description="Work order ID (PK)")
    ProductCode: Optional[str] = pa.Field(nullable=True, description="Product code")
    Status: Optional[str] = pa.Field(nullable=True, description="Work order status")
    Quantity: Optional[float] = pa.Field(nullable=True, ge=0, description="Order quantity")


class ProductionDataSchema(FmdBaseSchema):
    """MES Production Data — runtime production metrics."""
    ProductionDataID: int = pa.Field(ge=1, description="Production data ID (PK)")
    WorkOrderID: Optional[int] = pa.Field(nullable=True, description="Related work order")
    MachineID: Optional[str] = pa.Field(nullable=True, description="Machine identifier")

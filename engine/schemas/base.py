"""
Base Pandera schema for FMD pipeline DataFrames.

All schemas inherit from FmdBaseSchema to share common validation settings:
- strict=False: allow extra columns (source schemas evolve)
- coerce=True: attempt type coercion before failing
"""

import pandera.polars as pa


class FmdBaseSchema(pa.DataFrameModel):
    """Base schema for all FMD table validations.

    Subclass this and add column annotations per table.
    Use `strict=False` so extra columns from source don't fail validation.
    Use `coerce=True` so type mismatches are coerced before erroring.
    """

    class Config:
        strict = False
        coerce = True

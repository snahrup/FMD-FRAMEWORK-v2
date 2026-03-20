"""Base parser types and ExtractionResult contract.

All parsers produce an ExtractionResult containing tables, columns, queries,
measures, relationships, and data source references extracted from artifacts.
"""
from dataclasses import dataclass, field


@dataclass
class ExtractedTable:
    name: str
    schema_name: str | None = None
    source_database: str | None = None
    source_system: str | None = None
    entity_kind: str = "physical"  # physical|view|calculated|semantic_output|unknown
    columns: list["ExtractedColumn"] = field(default_factory=list)


@dataclass
class ExtractedColumn:
    column_name: str
    data_type: str | None = None
    nullable: bool = True
    is_key: bool = False
    source_expression: str | None = None
    is_calculated: bool = False
    ordinal: int | None = None


@dataclass
class ExtractedQuery:
    query_name: str | None = None
    query_text: str = ""
    query_type: str = "native_sql"  # native_sql|m_query|dax|stored_proc
    source_database: str | None = None
    parameters: list[str] | None = None


@dataclass
class ExtractedMeasure:
    measure_name: str
    expression: str
    expression_type: str = "dax"  # dax|m|sql
    description: str | None = None
    source_table: str | None = None


@dataclass
class ExtractedRelationship:
    from_entity: str
    from_column: str
    to_entity: str
    to_column: str
    join_type: str | None = None
    cardinality: str | None = None
    detected_from: str = "query_parse"  # query_parse|model_metadata|manual


@dataclass
class DataSourceRef:
    source_name: str
    source_type: str | None = None  # sql_db|lakehouse|warehouse|semantic_model|other
    database_name: str | None = None
    schema_name: str | None = None


@dataclass
class ExtractionResult:
    tables: list[ExtractedTable] = field(default_factory=list)
    columns: list[ExtractedColumn] = field(default_factory=list)
    queries: list[ExtractedQuery] = field(default_factory=list)
    measures: list[ExtractedMeasure] = field(default_factory=list)
    relationships: list[ExtractedRelationship] = field(default_factory=list)
    data_source_refs: list[DataSourceRef] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

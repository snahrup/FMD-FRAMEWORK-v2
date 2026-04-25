"""Auto-import all route modules to trigger @route decorator registration."""
import importlib
import logging
import pkgutil
from pathlib import Path

_pkg_dir = Path(__file__).parent
log = logging.getLogger("fmd.routes")

for _, module_name, _ in pkgutil.iter_modules([str(_pkg_dir)]):
    try:
        importlib.import_module(f".{module_name}", __package__)
    except ModuleNotFoundError as exc:
        if exc.name == "pyodbc":
            log.warning("Skipping route module %s because pyodbc is not installed", module_name)
            continue
        raise

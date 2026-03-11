"""Auto-import all route modules to trigger @route decorator registration."""
import importlib
import pkgutil
from pathlib import Path

_pkg_dir = Path(__file__).parent

for _, module_name, _ in pkgutil.iter_modules([str(_pkg_dir)]):
    importlib.import_module(f".{module_name}", __package__)

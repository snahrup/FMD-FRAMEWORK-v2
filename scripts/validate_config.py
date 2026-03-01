#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.lib.runtime_config import load_registry, validate_runtime_config


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate config/id_registry.json against runtime policy.")
    parser.add_argument("--config", default="config/id_registry.json")
    parser.add_argument("--strict", action="store_true", help="Fail on validation errors.")
    args = parser.parse_args()

    payload = load_registry(Path(args.config))
    errors = validate_runtime_config(payload)
    if errors:
        print("Config validation issues detected:")
        for error in errors:
            print(f" - {error}")
        return 1 if args.strict else 0
    print(f"Config validation passed: {args.config}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

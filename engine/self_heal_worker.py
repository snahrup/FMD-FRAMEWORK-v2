"""Detached daemon entry point for the bounded self-heal queue."""

from __future__ import annotations

import argparse
import logging
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

log = logging.getLogger("fmd.self_heal_worker")


def main() -> None:
    parser = argparse.ArgumentParser(description="FMD self-heal daemon")
    parser.add_argument("--loop", action="store_true", help="Process the queue forever.")
    parser.add_argument("--once", action="store_true", help="Process at most one queued case.")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        handlers=[logging.StreamHandler()],
    )

    from engine.self_heal import SelfHealDaemon

    daemon = SelfHealDaemon()
    if args.once and not args.loop:
        log.info("Self-heal daemon: single-pass mode")
        daemon.run_once()
        return

    log.info("Self-heal daemon: loop mode")
    daemon.run_forever()


if __name__ == "__main__":
    main()

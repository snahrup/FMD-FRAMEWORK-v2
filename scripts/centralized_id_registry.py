import os
import re
import json
import sys
from pathlib import Path

# Paths to the registry and other configuration files
# If we are in scripts/, root is parent. If we are in root, root is current.
current_dir = Path(__file__).parent
ROOT_DIR = current_dir.parent if current_dir.name == "scripts" else current_dir
REGISTRY_FILE = ROOT_DIR / "config" / "id_registry.json"

class IDRegistry:
    def __init__(self, registry_path=REGISTRY_FILE):
        self.registry_path = registry_path
        self.config = self.load_registry()
        
    def load_registry(self):
        """Loads the registry JSON file into a dictionary."""
        if not self.registry_path.exists():
            print(f"File not found: {self.registry_path}")
            return {}
        with open(self.registry_path, "r") as f:
            return json.load(f)

    def get_all_guids(self):
        """Returns a flat list of all explicitly managed GUIDs."""
        guids = []
        def _extract(obj):
            if isinstance(obj, dict):
                for v in obj.values():
                    _extract(v)
            elif isinstance(obj, str):
                if re.match(r'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$', obj, re.I):
                    guids.append(obj.lower())
        _extract(self.config)
        return set(guids)

    def generate_guid_map_json(self):
        """Generates the guid_map.json file based on mapping definitions."""
        guid_map = {}
        
        # Pull map from yaml
        if "workspaces" in self.config:
            ws = self.config["workspaces"]
            if "DATA_DEV" in ws and "DATA_PROD" in ws:
                guid_map[ws["DATA_DEV"]] = ws["DATA_PROD"]
            if "CODE_DEV" in ws and "CODE_PROD" in ws:
                guid_map[ws["CODE_DEV"]] = ws["CODE_PROD"]
                
        if "lakehouses" in self.config:
            lh = self.config["lakehouses"]
            if "LANDINGZONE_DEV" in lh and "LANDINGZONE_PROD" in lh:
                guid_map[lh["LANDINGZONE_DEV"]] = lh["LANDINGZONE_PROD"]
            if "BRONZE_DEV" in lh and "BRONZE_PROD" in lh:
                guid_map[lh["BRONZE_DEV"]] = lh["BRONZE_PROD"]

        map_path = ROOT_DIR / "guid_map.json"
        
        # Read the existing one to merge to not overwrite undocumented guids
        if map_path.exists():
            with open(map_path, "r") as f:
                existing_map = json.load(f)
                existing_map.update(guid_map)
                guid_map = existing_map

        with open(map_path, "w") as f:
            json.dump(guid_map, f, indent=2)
            
        print(f"Updated {map_path}")
        return guid_map

    def update_notebook_metadata(self):
        """Scans all `src/NB_*.Notebook/notebook-content.*` files and updates `# META` lines."""
        notebook_dir = ROOT_DIR / "src"
        if not notebook_dir.exists():
            return
            
        # Get defaults
        default_lh = self.config.get("lakehouses", {}).get("BRONZE_DEV", "")
        default_ws = self.config.get("workspaces", {}).get("DATA_DEV", "")
        
        updated_count = 0
        for path in notebook_dir.rglob("notebook-content.*"):
            with open(path, "r", encoding="utf-8") as f:
                content = f.read()

            new_content = re.sub(
                r'([#\-]+\s*META\s+"default_lakehouse":\s*")[^"]*(")',
                rf'\g<1>{default_lh}\g<2>',
                content
            )
            
            new_content = re.sub(
                r'([#\-]+\s*META\s+"default_lakehouse_workspace_id":\s*")[^"]*(")',
                rf'\g<1>{default_ws}\g<2>',
                new_content
            )

            if new_content != content:
                with open(path, "w", encoding="utf-8") as f:
                    f.write(new_content)
                print(f"Updated metadata in: {path.relative_to(ROOT_DIR)}")
                updated_count += 1
                
        print(f"Notebooks updated: {updated_count}")

    def sync_from_deploy_state(self, state_file=ROOT_DIR / ".deploy_state.json"):
        """Reads .deploy_state.json (if present) and updates the YAML registry."""
        if not state_file.exists():
            return
            
        with open(state_file, "r") as f:
            state = json.load(f)
            
        dirty = False
        
        # Sync workspace IDs
        if "workspace_ids" in state:
            for k, v in state["workspace_ids"].items():
                if k.upper() not in self.config.setdefault("workspaces", {}):
                    self.config["workspaces"][k.upper()] = v
                    dirty = True
                    
        # Sync databases / endpoint
        if "sql_db" in state:
            db_conf = self.config.setdefault("database", {})
            if db_conf.get("db_item_id") != state["sql_db"].get("id"):
                db_conf["db_item_id"] = state["sql_db"].get("id")
                dirty = True
            if db_conf.get("db_endpoint") != state["sql_db"].get("server"):
                db_conf["db_endpoint"] = state["sql_db"].get("server")
                dirty = True
                
        if dirty:
            with open(self.registry_path, "w") as f:
                json.dump(self.config, f, indent=2)
            print("Synced deploy state into registry.")

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Centralized ID Registry tools")
    parser.add_argument("--update-notebooks", action="store_true", help="Update all notebook metadata")
    parser.add_argument("--update-guid-map", action="store_true", help="Update guid_map.json")
    parser.add_argument("--sync-deploy", action="store_true", help="Sync from .deploy_state.json")
    parser.add_argument("--update-all", action="store_true", help="Run all updates")
    args = parser.parse_args()
    
    registry = IDRegistry()
    
    if args.sync_deploy or args.update_all:
        registry.sync_from_deploy_state()
        
    if args.update_notebooks or args.update_all:
        registry.update_notebook_metadata()
        
    if args.update_guid_map or args.update_all:
        registry.generate_guid_map_json()
        
    # If no flags passed, just dump config
    if not any(vars(args).values()):
        print(json.dumps(registry.config, indent=2))

# Optional: Sourcegraph MCP Integration

> **Status: NOT REQUIRED for base setup.**
> This repo is medium-sized (~636 source files) and self-contained. Sourcegraph adds value when:
> - You have multiple interconnected repos
> - You need cross-repo code intelligence or search
> - The codebase is too large for local tools to map effectively

---

## When to Add Sourcegraph

Consider adding Sourcegraph MCP if:
1. M3 ERP registration adds 3,973+ entities and the codebase grows significantly
2. You start maintaining parallel PROD/DEV branches with complex merge patterns
3. Cross-repo search becomes necessary (e.g., referencing code from other IP Corp projects)

## What You'd Need

1. **Sourcegraph instance** — Self-hosted or Sourcegraph Cloud
2. **Access token** — From your Sourcegraph account settings
3. **Repo indexed in Sourcegraph** — `snahrup/FMD-FRAMEWORK-v2`

## MCP Configuration Template

Add this block to `.mcp.json` under `mcpServers`:

```json
{
  "sourcegraph": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@anthropic-ai/mcp-sourcegraph"],
    "env": {
      "SOURCEGRAPH_ENDPOINT": "https://YOUR_INSTANCE.sourcegraph.com",
      "SOURCEGRAPH_ACCESS_TOKEN": "sgp_YOUR_TOKEN_HERE"
    },
    "timeout": 60,
    "description": "Remote code intelligence via Sourcegraph. Cross-repo search, code navigation, symbol lookup."
  }
}
```

**Alternative — Sourcegraph's official MCP server** (if available via their package):
```json
{
  "sourcegraph": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@anthropic-ai/mcp-sourcegraph"],
    "env": {
      "SRC_ENDPOINT": "https://YOUR_INSTANCE.sourcegraph.com",
      "SRC_ACCESS_TOKEN": "sgp_YOUR_TOKEN_HERE"
    }
  }
}
```

## Available Tools (Expected)

| Tool | Purpose |
|------|---------|
| `search` | Full-text and structural code search across indexed repos |
| `get_file` | Read file contents from indexed repos |
| `get_symbols` | Symbol lookup (functions, classes, interfaces) |
| `get_references` | Find all references to a symbol |
| `get_definitions` | Jump to definition |

## References

- [Sourcegraph MCP GA Announcement](https://sourcegraph.com/changelog/mcp-ga)
- [Sourcegraph 6.8 Release](https://sourcegraph.com/changelog/releases/6.8)
- [MCP Protocol Spec](https://modelcontextprotocol.io/)

---

*This file is documentation only. No configuration changes needed until you decide to proceed.*

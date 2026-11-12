---
name: lita
description: Use the project-local lita CLI to start, stop, inspect, restart and open the LitAnvil web reader.
---

# Lita CLI

This project uses the local `lita` command. Install or refresh the global link from the repository root with:

```sh
npm run install-cli
```

Useful commands:

```sh
lita start          # build and start API + Web in the background
lita start --open   # start and open the browser
lita open           # start if needed and open the browser
lita status
lita restart
lita stop
lita logs
```

The Web UI is at `http://localhost:5173` and the API is at `http://localhost:8787`. The CLI owns only the child processes recorded in `data/cli/`; do not kill unrelated processes occupying either port. If CLI code, package metadata, or this skill changes, rerun `npm run install-cli` before using the command.

# chat-memory

**English** | [한국어](README.ko.md)

A personal knowledge search box that automatically accumulates your Claude Code conversations and makes them **semantically searchable**. Fully local and offline.

> Full design spec: [SPEC.md](SPEC.md). The raw archive is the source of truth / the vector index is a regenerable derivative.

## Desktop app install (Engram) — for non-developers

No Python, no install commands — just one installer. (Windows)

### Option 1 — Installer (recommended)

1. Download **`Engram-Setup-0.1.0.exe`** (the number varies by version) and double-click it.
2. **Handling the unsigned warning**: if Windows shows *"Windows protected your PC / Unknown publisher"*, click **More info → Run anyway**. (If your browser warns on download, choose **Keep**.) — It's simply not code-signed; it's safe and works normally.
3. After installing, launch **Start menu → Engram**. Closing the window **hides it to the tray** (background indexing/sync keeps running); to **quit fully, right-click the tray icon → Quit**.

> Why the warning? We haven't attached a distribution code-signing certificate yet (they cost hundreds of dollars a year). Signing is only about trust indication and removing the warning — it has nothing to do with the app's functionality or safety.

### Option 2 — Portable (no install)

Unzip **`Engram-Setup-0.1.0.zip`** (portable package; the number varies by version) and run **`Engram.exe`** inside the folder. (Same app — it just isn't registered with the installer/Start menu.)

### First run

- On first run you pick an **embedding model** — if your machine is slow or low on RAM, the **"recommended for low-spec"** model is suggested. The chosen model is downloaded once, then indexing begins.
- After that, conversations are indexed automatically as they accumulate. Use the left ribbon to move between **Search / Sessions / 3D map / Settings**.
- **Multiple devices**: in Settings → **Device connection**, paste each other's codes to connect and your conversations sync automatically (each device builds its own index).
- **Search past conversations from other AI tools (Claude Code/Desktop, etc.)**: register it in Settings → **MCP integration**.
- Diagnostic log: `%APPDATA%\Engram\backend.log`.

## Running the standalone backend exe (alternative — no Electron shell)

Instead of the Electron app, you can run **just the backend exe folder** (access via a browser).

No Python, no install — just the exe folder.

1. Keep the received **`chatmem-backend` folder intact** and **double-click** `chatmem-backend.exe` (all files in the folder must be present for it to run).
2. After a moment your **browser opens automatically** (if not, go to `http://127.0.0.1:8765`).
3. On first run, **pick an embedding model** — for a slow/low-RAM machine, the **"recommended for low-spec"** model is suggested. It's downloaded once, then indexing begins.
4. After that, conversations are indexed automatically as they accumulate. On the left you can switch between **Search / Sessions / Clusters / 3D map / Settings**.

- To use **multiple devices**, connect them in Settings → **Device connection** by pasting each other's codes; conversations then sync automatically (each device builds its own index).
- To **search past conversations from other AI tools (Claude Code/Desktop, etc.)**, register it in Settings → **MCP integration**.
- Logs are kept in the folder's `data/app.log` (for troubleshooting).

## What it does

- Reads the JSONL logs that Claude Code auto-saves (`~/.claude/projects/**/*.jsonl`) **incrementally via a cursor**
- Parses into turns (question + answer + actions) → chunks → local embeddings (e5-large) → SQLite archive + numpy vector index
- `mem "query"` runs a semantic search → returns the **raw text + enriched summary + thread context**

## Quick start (easiest — 2 lines)

Installing with [pipx](https://pipx.pypa.io) handles the virtualenv and PATH for you.

```bash
pipx install "chat-memory[web] @ git+https://github.com/flyingjoojak/chat-memory.git"
chatmem setup
```

`setup` creates the folders/config and **registers a scheduler that auto-accumulates every 10 minutes**. After that it fills up hands-free (the embedding model, ~2.2 GB, downloads automatically on first run). To fill immediately, `chatmem setup --index`.

Search:

```bash
mem "how did I write the payroll calc logic"   # bare = search (terminal)
chatmem app                                     # desktop app (native window — Obsidian-like). Needs the [desktop] extra
python -m chatmem.web                            # web UI → http://127.0.0.1:8642 (browser)
```

> The desktop app needs `pip install "chat-memory[desktop]"` (pywebview). On Windows it requires the Edge WebView2 runtime (included by default on Win11).

## Install (from source / for development)

If you don't have pipx or want to modify the source:

```bash
git clone https://github.com/flyingjoojak/chat-memory.git && cd chat-memory
pip install ".[web]"          # core + web. With enrichment: ".[all]"  / dev: pip install -e ".[all]"
chatmem setup
```

Extras: `[web]` web UI · `[enrich]` enrichment backends (anthropic/openai·gemini·ollama) · `[all]` everything.
Installing creates the console command **`chatmem`** (alias **`mem`**). Without installing, `python -m chatmem <subcommand>` works identically.

## Command summary

```bash
chatmem setup [--index] [--no-scheduler]   # onboarding (folders, config, scheduler [, immediate backfill])
chatmem index                              # backfill / incremental indexing (the scheduler runs it automatically)
mem "query"                                # semantic search
chatmem search "..." -k 10 --since 2026-07-01 --until 2026-07-24 --session growth
chatmem scheduler status|install|uninstall # auto-accumulation scheduler
chatmem stats | config | progress          # status · config · backfill progress
```

## Architecture (core library + thin CLI)

| Module | Role |
|------|------|
| `parser.py` | Cursor-based incremental JSONL reading (tail-safe) · filters · turn grouping |
| `chunker.py` | Turn-based chunking + boundary splitting of long turns + parent-child |
| `embedder.py` | fastembed e5 (query/passage prefixes, L2 normalization) |
| `store.py` | SQLite archive (turns · chunks · cursors · enrichments · meta) |
| `vectorindex.py` | numpy brute-force vector search |
| `indexer.py` | pipeline · holds back the incomplete last turn · contextual embedding |
| `search.py` | **hybrid search** (semantic + keyword BM25, fused via RRF) · dedup · filters · threads |
| `cli.py` | the `mem` command |

## Enrichment (summary/tags) backends — pluggable

Enrichment is an **optional feature**; you pick a backend (`CHATMEM_ENRICH_BACKEND` or `--backend`):

| Backend | Description | Requirements |
|--------|------|-----------|
| `claude` (default) | Claude Code subscription (`claude -p`) | Claude Code installed & logged in |
| `anthropic` | Anthropic API | `pip install anthropic` + `ANTHROPIC_API_KEY` |
| `openai` | OpenAI (GPT) / OpenAI-compatible server | `pip install openai` + `OPENAI_API_KEY` |
| `gemini` | Google Gemini (OpenAI-compatible) | `pip install openai` + `GEMINI_API_KEY` |
| `ollama` | Local model (offline, free) | `pip install openai` + Ollama running |
| `off` | No enrichment (raw search only) | none — fully functional without enrichment |

`openai`/`gemini`/`ollama` are all **OpenAI-compatible APIs**, so a single `openai` SDK handles them. LM Studio, vLLM, Groq, etc. can also connect via the `openai` backend with a custom `CHATMEM_OPENAI_MODEL` + base_url.

```bash
# GPT
CHATMEM_ENRICH_BACKEND=openai OPENAI_API_KEY=sk-... python -m chatmem enrich

# Gemini
CHATMEM_ENRICH_BACKEND=gemini GEMINI_API_KEY=... python -m chatmem enrich

# Local (Ollama, fully offline, zero leakage)
CHATMEM_ENRICH_BACKEND=ollama CHATMEM_OLLAMA_MODEL=llama3.1 python -m chatmem enrich

# Turn enrichment off
python -m chatmem enrich --backend off
```

Embedding and hybrid search work the same without enrichment. Enrichments are just result headlines (for display); search itself is based on the raw text.

## MCP server — let other AIs search your past conversations

Registering `chatmem-mcp` as an MCP server lets Claude Code, Desktop, etc. **directly search and view past sessions** (local hybrid search, returning raw text + summary).

> **Easiest way**: in the app, **Settings → MCP integration**, use the **register/unregister buttons** per target (Claude Code / Claude Desktop / Codex CLI / Gemini CLI). Each config file is backed up as `.bak` before editing; after registering, restart that client. (Manual method below.)

```bash
pip install ".[mcp]"          # mcp SDK
# Claude Code:
claude mcp add chat-memory -- chatmem-mcp
```

Config JSON for Claude Desktop, etc.:

```json
{ "mcpServers": { "chat-memory": { "command": "chatmem-mcp" } } }
```

Exposed tools: `search_memory` (semantic + keyword search) · `get_session` (full session) · `recent_sessions` · `stats`.
All read the same local data (the same archive), and the embedding model is loaded once on the first search.

## Configuration (environment variables or config file)

Configure either way. **Environment variables always take precedence**; otherwise config-file values are used.

**Config file (recommended)** — writing `KEY=VALUE` lines in `~/chat-memory/config.env` means **the CLI, nightly enrichment scheduler, and web UI all read it automatically** (no need to permanently register OS environment variables or edit `.cmd` files). Copy [`config.env.example`](config.env.example) to start.

```bash
cp config.env.example ~/chat-memory/config.env   # uncomment only the values you want
python -m chatmem config                          # check the effective config & file location
```

> `config.env` may contain API keys, so it's excluded via `.gitignore`. Never commit it.

### Key list

- `CHATMEM_DATA_DIR` — data storage location (default `~/chat-memory/data`)
- `CLAUDE_PROJECTS_DIR` — log source (default `~/.claude/projects`)
- `CHATMEM_EMBED_MODEL` — embedding model (changing it requires a full re-index)
- `CHATMEM_ENRICH_BACKEND` — `claude` (default) / `anthropic` / `openai` / `gemini` / `ollama` / `off`
- `CHATMEM_ENRICH_API_MODEL` — anthropic model (default `claude-sonnet-5`)
- `CHATMEM_OPENAI_MODEL` / `CHATMEM_GEMINI_MODEL` / `CHATMEM_OLLAMA_MODEL` — model for each backend
- `CHATMEM_OLLAMA_URL` — Ollama endpoint (default `http://localhost:11434/v1`)

## Data & privacy

By default **everything is local**. The conversation archive (archive.db) and vector index are stored on this device at
`~/chat-memory/data` (change with `CHATMEM_DATA_DIR`), and no data is sent to any server in normal use.

Data can leave the device only via **three features you opt into**:

1. **Cloud enrichment AI** — if you set the enrichment backend to Anthropic/OpenAI/Gemini, parts of conversations are sent to that API for summarization/tagging. `claude` (subscription), `ollama` (local), and `off` send nothing externally.
2. **Device sync (Syncthing)** — turning on device connection syncs your conversation logs P2P **between your own connected devices**. It's a direct device-to-device transfer that doesn't go through any third-party server, and the transport is encrypted. The bundled Syncthing binary is fetched from official releases and **verified via SHA-256** before running.
3. **MCP integration** — once registered, the AI tool you registered (Claude Code, etc.) can **search and view** your local conversations. If that tool is a cloud model, it may send returned conversations to its model (behavior on the tool's side).

Otherwise:
- **No telemetry, usage stats, or automatic error reports are collected.**
- The "report an issue" feature (log-format-change detection) **does not send conversation content** — it sends only a format fingerprint, with values masked.
- Secrets such as API keys are stored only in the local config file, and responses expose only whether they're set (true/false).

## Status

Phase 1 (core + CLI) and Phase 2 (FastAPI + React + Electron desktop app) are implemented and tested.
It has automatic indexing of Codex CLI/Desktop and Claude Code, device sync (bundled Syncthing), MCP integration, auto-update, and 3-OS release CI. The remaining distribution work is code signing (a certificate) and real-world validation of the first release.

## Release (distribution & versioning)

Pushing a version tag (`vX.Y.Z`) makes GitHub Actions build the Windows/Linux/macOS installers and upload them automatically to the GitHub release (including `latest.yml` for auto-update). Steps:

1. Bump `version` in `electron/package.json` (e.g. `0.2.0`).
2. Summarize the changes in `CHANGELOG.md`.
3. Push a matching version tag: `git tag v0.2.0 && git push origin v0.2.0`.
4. Actions builds the 3-OS installers and attaches them to the `v0.2.0` release.
5. **The GitHub release body (release notes) is shown as-is in the app's update banner**, so putting the CHANGELOG content into the release body surfaces it to users.

> **Bilingual release notes**: split the release body into English/Korean sections with `<!--lang:en-->` / `<!--lang:ko-->` markers, and GitHub shows both while the app's update banner shows only the section matching the user's app language (if no markers are present, the whole body is shown as-is).

> The current installers are **unsigned** — Windows SmartScreen / macOS Gatekeeper warnings may appear.
> Once a code-signing certificate is ready, you only need to add the signing secrets to CI.

### macOS install & update (Homebrew recommended)

macOS **blocks auto-update for unsigned apps** (Squirrel.Mac requires code signing). So on macOS, **install and update via Homebrew** is recommended — Homebrew handles the download/replacement and removes the quarantine, so **it installs and updates even without signing, with no Gatekeeper warning.**

```bash
brew tap flyingjoojak/chat-memory https://github.com/flyingjoojak/chat-memory
brew install --cask flyingjoojak/chat-memory/engram   # install
brew upgrade --cask engram                            # update
```

For mac users who **downloaded the dmg directly** without Homebrew, when the app detects a new version it **notifies via the update banner and opens the download page** (it can't auto-replace, so download the new dmg and drag it into Applications to replace). On Windows, **auto-update works from the banner** even while unsigned.

## License

MIT License — see [LICENSE](LICENSE).

For device-to-device sync it bundles and runs the [Syncthing](https://syncthing.net/) (MPL-2.0) engine; licenses and sources of other third-party components are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

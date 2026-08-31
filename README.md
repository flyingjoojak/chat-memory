<div align="center">

<img src="docs/assets/banner.png" alt="Engram" width="100%">

### The private, searchable memory for your AI coding conversations

[![License: MIT](https://img.shields.io/badge/license-MIT-10b981.svg)](LICENSE)
![Platforms](https://img.shields.io/badge/Windows%20%7C%20macOS%20%7C%20Linux-1f2937)
![Local & Offline](https://img.shields.io/badge/100%25-local%20%26%20offline-10b981)
![Built with](https://img.shields.io/badge/Python%20·%20React%20·%20Electron-47848F)

**English** · [한국어](README.ko.md)

</div>

> **Claude Code and Codex forget everything the moment a session ends. Engram remembers.**
> It runs quietly on your computer, saves every conversation you have with your AI coding assistant,
> and turns them into a **private, instantly searchable memory** — so the fix you figured out three
> weeks ago is one search away. Nothing leaves your machine.

<!--
  ▶ Drop a demo GIF or screenshot here to make the top land instantly.
  Put the file in docs/assets/ and uncomment (see docs/assets/README.md — includes a privacy note):

  <div align="center">
    <img src="docs/assets/demo.gif" alt="Searching past conversations in Engram" width="860">
  </div>

  For a playable video, drag an .mp4 into a GitHub issue/release to get a
  github.com/user-attachments/... URL, then paste that URL on its own line here.
-->

---

## What is Engram?

Engram is a desktop app that watches the logs **Claude Code and Codex already write on your machine**,
indexes them locally with an embedding model, and gives you an instant **search box over your entire
history** — plus a **3D map** of everything you've worked on.

No accounts, no cloud, no telemetry. Your conversations stay on your device.

## Features

- 🔒 **100% local & offline** — conversations never leave your machine
- 🔍 **Hybrid search** — find by *meaning* (semantic) or *exact words* (keyword), fused together
- 🗺️ **3D memory map** — your history clustered into topics you can fly through
- 🔌 **Claude Code + Codex** — both are auto-detected and indexed together
- ↔️ **Multi-device sync** — peer-to-peer, no cloud (a Syncthing engine is built in)
- 🤖 **MCP server** — let your AI assistant search its own past sessions

## Download

Grab the latest build from the [**Releases**](https://github.com/flyingjoojak/chat-memory/releases) page.

| Platform | How to install |
|---|---|
| **Windows** | Download `Engram-Setup-<version>.exe` and run it. First launch: *More info → Run anyway* (the app isn't code-signed yet — it's safe). Or use the portable `.zip` and run `Engram.exe`. |
| **macOS** | `brew tap flyingjoojak/chat-memory https://github.com/flyingjoojak/chat-memory` then `brew install --cask flyingjoojak/chat-memory/engram`. Update with `brew upgrade --cask engram`. |
| **Linux** | Download the `.AppImage`, `chmod +x`, and run. |

**On first launch** you pick an embedding model (a *low-spec* option is offered for slower machines).
It downloads once, then Engram indexes your conversations automatically and keeps up as you chat.
Use the left rail for **Search · Sessions · 3D map · Settings**.

> **Why the “unknown publisher” warning?** The app isn’t code-signed yet (certificates cost hundreds of dollars a year). Signing only removes the OS warning — it has nothing to do with safety or function.

## How it works

```
Claude Code / Codex logs  →  read incrementally  →  turns (question + answer + actions)
      →  local embeddings (multilingual e5-large)  →  SQLite archive + vector index
      →  hybrid search: meaning ⊕ keywords
```

Your **raw conversations are the source of truth**; the search index is a regenerable derivative, so
re-indexing or switching models is always lossless. Full design notes: [SPEC.md](SPEC.md).

---

<details>
<summary><b>🔐  Privacy — what stays, what can leave</b></summary>

<br>

By default **everything is local** (`~/chat-memory/data`) and nothing is sent anywhere. Data leaves the device **only via three features you explicitly turn on:**

1. **Cloud summaries** — if you pick a cloud AI (Anthropic/OpenAI/Gemini) for optional summaries, parts of conversations go to that API. The `claude` (subscription), `ollama` (local) and `off` options send nothing.
2. **Device sync** — connecting devices syncs logs **peer-to-peer between your own machines**, encrypted, through no third-party server. The bundled Syncthing binary is verified via SHA-256.
3. **MCP** — a tool you register can search/view your local conversations; if it’s a cloud model, returned text may reach that model.

No telemetry, no usage stats, no automatic error reports. The “report an issue” feature sends only a masked format fingerprint — never conversation content.

</details>

<details>
<summary><b>⌨️  For developers — CLI & source install</b></summary>

<br>

Engram is built on a Python core (`chatmem`) with a thin CLI. Install from source:

```bash
git clone https://github.com/flyingjoojak/chat-memory.git && cd chat-memory
pip install ".[web]"          # core + web UI.  Everything: ".[all]"  ·  dev: pip install -e ".[all]"
chatmem setup                 # folders, config, and a scheduler that auto-indexes every 10 min
```

Or with [pipx](https://pipx.pypa.io):

```bash
pipx install "chat-memory[web] @ git+https://github.com/flyingjoojak/chat-memory.git"
chatmem setup
```

```bash
mem "how did I write the payroll calc logic"   # terminal search
python -m chatmem.web                            # web UI → http://127.0.0.1:8642
chatmem search "..." -k 10 --since 2026-07-01 --session growth
chatmem stats | config | progress                # status · config · progress
```

> Extras: `[web]` web UI · `[enrich]` cloud/local summary backends · `[mcp]` MCP server · `[all]` everything.

</details>

<details>
<summary><b>✨  Optional summaries — pluggable backends</b></summary>

<br>

Summaries/tags are **optional** (search runs on the raw text). Pick a backend via `CHATMEM_ENRICH_BACKEND`:

| Backend | Description | Requirements |
|--------|------|-----------|
| `claude` (default) | Claude Code subscription (`claude -p`) | Claude Code installed & logged in |
| `anthropic` / `openai` / `gemini` | Cloud APIs | that SDK + API key |
| `ollama` | Local model (offline, free) | Ollama running |
| `off` | No summaries (raw search only) | none |

`openai`/`gemini`/`ollama` all speak the OpenAI-compatible API (LM Studio, vLLM, Groq, … work too).

```bash
CHATMEM_ENRICH_BACKEND=ollama CHATMEM_OLLAMA_MODEL=llama3.1 python -m chatmem enrich   # local, zero leakage
```

</details>

<details>
<summary><b>🤖  MCP server — let other AIs search your past conversations</b></summary>

<br>

Registering `chatmem-mcp` lets Claude Code, Desktop, etc. **search and view** your sessions (local hybrid search → raw text + summary).

> **Easiest:** in the app, **Settings → MCP integration**, use the register buttons per target.

```bash
claude mcp add chat-memory -- chatmem-mcp
```

```json
{ "mcpServers": { "chat-memory": { "command": "chatmem-mcp" } } }
```

Tools: `search_memory` · `get_session` · `recent_sessions` · `stats`.

</details>

<details>
<summary><b>🚀  Release &amp; versioning (maintainers)</b></summary>

<br>

Pushing a tag (`vX.Y.Z`) makes GitHub Actions build the Windows/Linux/macOS installers and attach them to the release (with `latest.yml` for auto-update):

1. Bump `version` in `electron/package.json`, summarize changes in `CHANGELOG.md`.
2. `git tag v0.2.0 && git push origin v0.2.0`.
3. **The release body shows in the app’s update banner** — split it with `<!--lang:en-->` / `<!--lang:ko-->` markers and the banner shows the section matching the user’s language.

macOS: unsigned apps can’t auto-update, so install/update via **Homebrew** (no Gatekeeper warning). Windows auto-updates from the banner even while unsigned.

</details>

## License

**MIT** — see [LICENSE](LICENSE). Engram bundles the [Syncthing](https://syncthing.net/) (MPL-2.0) engine for device sync; other third-party licenses are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

<div align="center"><br><sub>Built for people who talk to their AI all day — and want to remember what they said.</sub></div>

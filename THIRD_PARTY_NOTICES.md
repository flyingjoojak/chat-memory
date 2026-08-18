# Third-Party Notices

chat-memory is licensed under the MIT License (see [LICENSE](./LICENSE)).
It uses, and in one case redistributes, third-party software listed below.
Each component remains under its own license; nothing here changes those terms.

---

## Redistributed binary — Syncthing

chat-memory drives an **embedded [Syncthing](https://syncthing.net/)** engine for
optional device-to-device sync. The official, **unmodified** pre-built Syncthing
binary is downloaded at runtime from Syncthing's GitHub releases (or bundled
verbatim in packaged builds) and executed as a separate process — chat-memory
does not modify or statically link Syncthing.

- **Project:** Syncthing
- **License:** Mozilla Public License 2.0 (MPL-2.0)
- **Source code:** https://github.com/syncthing/syncthing
- **License text:** https://github.com/syncthing/syncthing/blob/main/LICENSE
- **Pinned version:** see `SYNCTHING_VERSION` in `chatmem/syncthing.py`

Under MPL-2.0, the source code for the redistributed binary is available at the
URL above. No changes are made to Syncthing's source; the binary is used as
published by the Syncthing project.

---

## Python dependencies

| Package | License | Project |
|---|---|---|
| fastembed | Apache-2.0 | https://github.com/qdrant/fastembed |
| numpy | BSD-3-Clause | https://github.com/numpy/numpy |
| fastapi | MIT | https://github.com/fastapi/fastapi |
| uvicorn | BSD-3-Clause | https://github.com/encode/uvicorn |
| pywebview | BSD-3-Clause | https://github.com/r0x0r/pywebview |
| sqlite-vec | Apache-2.0 / MIT | https://github.com/asg017/sqlite-vec |
| umap-learn | BSD-3-Clause | https://github.com/lmcinnes/umap |
| scikit-learn | BSD-3-Clause | https://github.com/scikit-learn/scikit-learn |
| mcp (Python SDK) | MIT | https://github.com/modelcontextprotocol/python-sdk |
| anthropic (SDK) | MIT | https://github.com/anthropics/anthropic-sdk-python |
| openai (SDK) | Apache-2.0 | https://github.com/openai/openai-python |

`anthropic` / `openai` are optional (only when the enrichment backend is set to
that provider). `pywebview`, `sqlite-vec`, `umap-learn`, `scikit-learn`, `mcp`
are optional extras.

### Embedding models (downloaded at runtime)

Embedding models are fetched on first use from the Hugging Face Hub and are not
redistributed with this project. The defaults (e.g. the `intfloat/multilingual-e5`
family and `BAAI/bge` family) are published under the MIT License by their
respective authors; consult each model card for its exact terms.

---

## Frontend dependencies

| Package | License | Project |
|---|---|---|
| react, react-dom | MIT | https://github.com/facebook/react |
| three | MIT | https://github.com/mrdoob/three.js |
| tailwindcss, @tailwindcss/vite | MIT | https://github.com/tailwindlabs/tailwindcss |
| shadcn (ui) | MIT | https://github.com/shadcn-ui/ui |
| @base-ui/react | MIT | https://github.com/mui/base-ui |
| lucide-react | ISC | https://github.com/lucide-icons/lucide |
| d3-force | ISC | https://github.com/d3/d3-force |
| class-variance-authority | Apache-2.0 | https://github.com/joe-bell/cva |
| clsx | MIT | https://github.com/lukeed/clsx |
| tailwind-merge | MIT | https://github.com/dcastil/tailwind-merge |
| tw-animate-css | MIT | https://github.com/Wombosvideo/tw-animate-css |
| vite, @vitejs/plugin-react | MIT | https://github.com/vitejs/vite |
| typescript | Apache-2.0 | https://github.com/microsoft/TypeScript |
| oxlint | MIT | https://github.com/oxc-project/oxc |

### Bundled font

- **Geist** (`@fontsource-variable/geist`) — SIL Open Font License 1.1 (OFL-1.1) —
  https://github.com/vercel/geist-font

---

_License classifications above are provided in good faith from each project's
published license at the time of writing. The authoritative license for any
component is the one shipped in that component's own distribution._

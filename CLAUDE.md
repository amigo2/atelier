# CLAUDE.md

Atelier is a diagram and slide editor: React Flow canvas (Vite, React 19, TypeScript, zustand) and a FastAPI
backend that stores diagrams as JSON files and exports PDF/PNG. Running and using it: [README.md](README.md).
What comes next and why: [docs/ROADMAP.md](docs/ROADMAP.md). Each feature has a spec in `docs/SPEC-*.md`;
its status line at the top says what was built and measured.

## How to work here

- **Spec first.** A new feature gets a spec in `docs/` and an approved plan before code. The owner sets the pace.
- **No push and no PRs** unless asked in the current conversation.
- **Never delete files or folders:** move them to `~/Desktop/_archive/` and say so.
- **Measure, don't assume.** Check changes in a real browser against a running server, and say when a belief
  turns out false.
- **English everywhere:** code, UI, docs.
- **API keys** live in `~/.atelier/{anthropic,openai,google}.env`, outside the repo. Never print, copy or
  commit them. The owner creates those files.

## Run and test

- Server: `ATELIER_DATA=~/.atelier/data api/.venv/bin/uvicorn app.main:app --app-dir api --port 8100`.
  Frontend changes need only `cd web && npm run build` and a reload, not a restart.
- Tests (all must pass before a commit):
  - `cd web && npm test`: unit tests (vitest), including the rich-text round trips
  - `api/.venv/bin/pytest e2e`: the editor in Chromium (build `web` first)
  - `cd api && .venv/bin/pytest`: the API
- `ATELIER_NO_MODEL=1` forces the scripted chat; tests never call the model.
- Throwaway test servers: use ports in the 8110s–8120s with a scratch `ATELIER_DATA`. **Avoid 8118**
  (often taken by a local proxy).

## Where things are, and the traps

- **Text markup** (`**b**`, `*i*`, `~~s~~`, `{red,large,b:..}`, `* ` bullets, `\` escapes): one reader and
  writer in `web/src/richtext/markup.ts`. The canvas renderer, the panel editor (TipTap) and `doc.ts` all go
  through it. Any change needs a round-trip test in `markup.test.ts`.
- **Sizing** is `web/src/fit.ts`. `data.auto` = the element follows its words both ways; a hand-resized one
  only grows. Measure at the element's *final* width (measuring the live textarea mid-paste made boxes balloon).
- **Editing on the canvas:** Enter saves; Shift/Ctrl/Alt+Enter is a new line. Scripts that type `\n` save
  the field instead.
- **Toolbar tools arm on click** and place at the next canvas click (`components/PlaceTool.tsx`); e2e tests use
  a `place(page, label)` helper.
- **Lines:** free ends are `point` nodes; ends attach anywhere along an edge (`t@0.82` handle ids, `snap.ts`);
  lines draw above everything (`LINE_Z`). Layers come from containment depth (`layers.ts`).
- **The AI chat** (`api/app/assist.py`) respects locked elements and runs the ASCII box-drawing import
  (`ascii_import.py`) before any model call. It does not know about groups yet.

## Status (2026-11-24)

- Built: lines and toolbar, layers, lock, groups, rich text phase 1 (panel editor), ASCII import, click-to-place.
- Next candidates: rich text phase 2 (same editor on the canvas), e2e tests for lines and the panel editor,
  then the roadmap (presenter mode, pen and iPad, face-cam recording, transcripts, image generation).
- Deploy ([docs/SPEC-Deploy-Atelier.md](docs/SPEC-Deploy-Atelier.md)): Dockerfile done and built locally. Not
  live yet. It will run at `atelier.<domain>` on the owner's Dokploy, behind basic auth. The domain is about
  to change, so it isn't written here.
- No Anthropic key yet, so the chat runs scripted.

# Spec: Atelier live, next to the course app

Status: **approved 2026-11-22, option (A): no link in the course site yet.** Steps 1 and 2 done
and checked locally. Steps 3 to 5 (DNS, Dokploy, moving the diagrams) are yours, on the server.

What building it showed:

- **Image: 2.1 GB** (arm64). Chromium and its libraries are most of it.
- Two build fixes: install `libatomic1` (Playwright's installer needs it on the slim image), and
  fetch Debian packages over **https**. Over plain http, every build failed with "Hash Sum
  mismatch" on a different package, which points to something on this network altering
  downloads.
- **Checked in the container:** `/api/health` ok, PDF export returns a real PDF (Chromium works),
  and a diagram survived a brand-new container on the same volume. **Not checked:** the AI live
  in the container, because no Anthropic key exists on this machine yet.
- **Images do not travel in a downloaded diagram.** It stores only `/api/images/<hash>`. Of the 7
  diagrams, only "E2E PDF" has an image (a test image). To move images, copy the whole data
  folder onto the volume instead.
- Course repo: scenes moved to `course/scenes/`. The GUIDE-01 diagrams endpoint returns the same
  4 diagrams before and after, locally and inside the rebuilt course image, which still passes
  the "course/notes not leaked" check. `video-studio/` was archived to
  `~/Desktop/_archive/video-studio` with `node_modules`, so nothing was deleted.

## Goal

Atelier runs online at **`atelier.<domain>`**, on the same OVH VPS and Dokploy as the course app.
Only the instructor can get in for now. The two apps stay in **separate repositories** and deploy
separately. They meet in the browser, never in the code.

```
                ┌──────────────────────── OVH VPS · Dokploy ────────────────────────┐
  <domain> ─────┼──► Traefik ──►  course-app   (repo: let-the-nerds-lead)  public   │
                │       │                                                           │
  atelier. ─────┼───────┴────►  atelier      (repo: amigo2/atelier)  password       │
  <domain>      │                    │                                              │
                │                    └── volume: /data  (diagrams, images)          │
                └───────────────────────────────────────────────────────────────────┘
```

## 1. An Atelier container

Atelier has no Dockerfile yet. Add one to the Atelier repo, in the same shape as the course app's:

- **Build stage (Node 22):** `npm ci` and `npm run build` in `web/`.
- **Runtime (Python 3.11-slim):** install `api/requirements.txt`, then
  `python -m playwright install --with-deps chromium`. PDF export prints through Chromium, so the
  browser has to be in the image. This is what makes the image heavy (several hundred MB). The
  course app doesn't need it.
- Copy `api/` and the built `web/dist`. Run `uvicorn app.main:app --app-dir api --host 0.0.0.0
  --port ${PORT:-8100}`.
- Add a `.dockerignore`: no `data/`, `exports/`, `node_modules/`, `.venv/` or `e2e/artifacts/`.

### Settings (Dokploy environment, never in git)

| Variable | Value | Why |
|---|---|---|
| `PORT` | `8100` | What the container listens on |
| `ATELIER_DATA` | `/data` | Diagrams and images go to the volume, not into the container |
| `ANTHROPIC_API_KEY` | the key | The chat. Set in Dokploy's environment panel only |

## 2. Data that survives a redeploy

Diagrams are JSON files and images are files. A container's own disk is wiped on every redeploy,
so:

- **A Dokploy volume mounted at `/data`.** Redeploys keep it.
- **Moving the 7 existing diagrams over:** use each one's **Download** (`.atelier.json`) locally,
  then **Import** on the live site. It's slow but needs no server access, and it is the transfer
  path Atelier already has. Images inside a diagram need checking: do they travel with the JSON,
  or only as references to `data/images`? To be measured before relying on it.
- **Backups: none yet.** The volume is a single copy on one VPS. Until the database arrives,
  downloading the important diagrams now and then is the backup. Say so rather than pretend
  otherwise.

## 3. Only the instructor gets in

Atelier has no login. Online without protection, anyone with the address could read, change or
delete diagrams and spend Anthropic credit through the chat.

- **Phase 1: a password on the whole subdomain**, using Dokploy's per-application basic auth
  (Traefik). No code changes. It covers the API too, so the chat cannot be called without the
  password.
- The password goes in a password manager, never in a repo or a chat.
- A later phase with real login replaces this, when other teachers are added.

## 4. In the course app

- **Phase 1: a link, opening Atelier in a new tab.** Not embedded. Browsers block a password
  prompt from inside an embedded page on another subdomain, so an embedded Atelier behind basic
  auth would just show as broken.
- **Decision needed:** where the link appears. The course site is public, so students would see
  it and get a password prompt if they clicked it.
  - **(A) No link yet.** You bookmark `atelier.<domain>`. The course site is unchanged.
  - **(B) A small "Studio ↗" link in the header**, visible to everyone and harmless (password).
  - **Recommendation: (A)** until login exists. Then the link and an embedded full-screen Studio
    page arrive together, both signed in with one cookie on `<domain>`.

## 5. Course repo: give the lesson diagrams their own home

The live course app reads **`video-studio/scenes/*.json`** for the step-through diagrams on lesson
pages (`app/api/services/diagrams.py`, the `Dockerfile`, `.dockerignore`). `video-studio/` is
being retired in favour of Atelier, so before it is archived:

- Move `video-studio/scenes/` to `course/scenes/`.
- Update the path in `app/api/services/diagrams.py`, the `COPY` in the `Dockerfile`, and the
  `video-studio` rules in `.dockerignore`.
- Then archive `video-studio/` to `~/Desktop/_archive/video-studio`, without `node_modules`.

This is the only change in the course repo.

## 6. DNS

An `A` record for `atelier.<domain>` pointing at the VPS, the same IP as `<domain>`. Dokploy
gets the TLS certificate through Traefik.

## Order of work

1. Course repo: move the scenes, check lesson diagrams still load locally, then archive
   `video-studio/`.
2. Atelier repo: Dockerfile and `.dockerignore`. Build and run it locally with a volume.
3. DNS record (you, at the domain registrar).
4. Dokploy: new application from `amigo2/atelier`, volume, environment, basic auth, domain.
   Done by you in the Dokploy panel, following written steps. I don't have access to the server.
5. Move the diagrams over.

## How it will be checked

On this machine, before anything goes to the server:

- `docker build` succeeds. The container answers `/api/health`.
- A diagram created in the container is still there after the container is removed and started
  again on the same volume.
- **PDF export works inside the container** (Chromium present). This is the likeliest thing to
  break.
- With the key set, `/api/ai` reports `"live": true`.
- Course app: after the scenes move, the lesson diagrams endpoint still returns GUIDE-01's
  diagrams, and `docker build` of the course image still passes its "course/notes not leaked"
  check.

On the server, after deploy (commands you run, or output you paste back):

- `curl -I https://atelier.<domain>` without the password returns **401**. With it, **200**.
- A diagram survives a redeploy.
- `https://<domain>` is unchanged.

## Out of scope

Login and accounts, other teachers, the database, an embedded Studio page in the course app, and
automatic backups.

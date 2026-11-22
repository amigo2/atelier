# Atelier in one container: the built editor and the API from the same origin, as in the course app.

# --- build the editor ---
FROM node:22-slim AS web
WORKDIR /web
COPY web/package*.json ./
RUN npm ci --no-fund --no-audit
COPY web/ ./
RUN npm run build

# --- runtime ---
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    # Diagrams and images live on a volume, never in the container: a redeploy replaces the container.
    ATELIER_DATA=/data \
    # Chromium goes somewhere fixed, so it does not depend on which user runs the app.
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /srv

COPY api/requirements.txt api/requirements.txt
RUN pip install --no-cache-dir -r api/requirements.txt

# PDF export prints the pages with Chromium, so the browser and the system libraries it needs are part
# of the image. This is most of the image's size, and the reason it is bigger than the course app's.
#
# libatomic1 first: the small Node runtime Playwright installs with needs it, and the slim image lacks it
# (the build failed without it, on arm64).
#
# Packages over https: over plain http, something between this machine and Debian served altered files
# ("Hash Sum mismatch" on a different package each build).
RUN sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources \
 && apt-get update && apt-get install -y --no-install-recommends libatomic1 && rm -rf /var/lib/apt/lists/* \
 && python -m playwright install --with-deps chromium

COPY api api
COPY --from=web /web/dist web/dist

VOLUME ["/data"]
EXPOSE 8100

CMD ["sh", "-c", "uvicorn app.main:app --app-dir api --host 0.0.0.0 --port ${PORT:-8100}"]

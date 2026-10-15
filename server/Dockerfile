# amiri-server with the web app built in. Build from the repository root (it needs web/ and server/):
#
#     docker build -f server/Dockerfile -t amiri-server .
#
# Cloud Run sets PORT; locally it defaults to 8080. Settings come from the environment (there is no .env in
# the image): see server/.env.example.

FROM node:24-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.8.13 /uv /uvx /bin/
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PROJECT_ENVIRONMENT=/srv/venv PYTHONUNBUFFERED=1
WORKDIR /srv/server
COPY server/pyproject.toml server/uv.lock server/README.md ./
RUN uv sync --frozen --no-dev --no-install-project
COPY server/app ./app
RUN uv sync --frozen --no-dev
COPY --from=web /web/dist /srv/web/dist
ENV PATH=/srv/venv/bin:$PATH WEB_DIST=/srv/web/dist
RUN useradd --system --uid 10001 amiri
USER amiri
EXPOSE 8080
# --proxy-headers: Cloud Run ends TLS; the session cookie is Secure because the original scheme was https
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080} --proxy-headers --forwarded-allow-ips='*'"]

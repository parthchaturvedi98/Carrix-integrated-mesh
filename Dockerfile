# --- stage 1: build the React command centre -------------------------------
FROM node:20-alpine AS ui
WORKDIR /ui
COPY ui/package.json ui/package-lock.json ./
RUN npm ci
COPY ui/ ./
# this image ships the Python backend (live Claude), so build the UI to talk to it
ENV VITE_USE_BACKEND=true
RUN npm run build          # produces /ui/dist

# --- stage 2: python runtime (serves API + mocks + the built UI) ------------
FROM python:3.12-slim
WORKDIR /app

# only dependency is httpx (the rest is the Python standard library)
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# app source, then the built UI from stage 1
COPY . .
COPY --from=ui /ui/dist ./ui/dist

# listen on all interfaces and the platform-provided port; keep writable paths in /tmp
ENV HOST=0.0.0.0 \
    PORT=8000 \
    PYTHONPATH=/app \
    CARRIX_DB_PATH=/tmp/carrix.db \
    CARRIX_LOG_PATH=/tmp/carrix_trace.log \
    PYTHONUNBUFFERED=1
EXPOSE 8000

# ANTHROPIC_API_KEY is provided at runtime by the host's secret store (optional —
# without it the app serves in deterministic fallback mode).
CMD ["python", "-m", "api.server"]

FROM python:3.12-slim

ENV UV_LINK_MODE=copy \
    UV_HTTP_TIMEOUT=300 \
    UV_HTTP_RETRIES=10 \
    UV_CONCURRENT_DOWNLOADS=2
RUN pip install --no-cache-dir --default-timeout=300 --retries 10 uv

WORKDIR /srv/backend
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY app ./app
RUN uv sync --frozen --no-dev

EXPOSE 8000
CMD ["uv", "run", "--no-sync", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

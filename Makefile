.PHONY: e2e precompute install test lint format ingest snapshot openapi dev-backend dev-frontend build up down

install:
	cd backend && uv sync
	cd frontend && npm ci

test:
	cd backend && uv run pytest
	cd frontend && npm test

e2e:
	uv run --with playwright python frontend/e2e/liveness.py

lint:
	cd backend && uv run ruff check app tests && uv run ruff format --check app tests && uv run mypy
	cd frontend && npm run lint

format:
	cd backend && uv run ruff check --fix app tests && uv run ruff format app tests

ingest:
	cd backend && uv run python -m app.ingest

snapshot:
	cd backend && uv run python -m app.ingest.snapshot

openapi:
	cd backend && uv run python -c "import json; from app.main import app; json.dump(app.openapi(), open('../frontend/openapi.json', 'w'), ensure_ascii=False, indent=1)"
	cd frontend && npm run gen:api

dev-backend:
	cd backend && uv run uvicorn app.main:app --reload --port 8000

dev-frontend:
	cd frontend && npm run dev

build:
	cd frontend && npm run build

up:
	docker compose up --build

down:
	docker compose down

precompute:
	cd backend && uv run python -m app.rotation.precompute_imagery && uv run python -m app.rotation.precompute

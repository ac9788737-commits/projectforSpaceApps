# Деплой на Railway

Два сервиса из одного репозитория: **backend** (FastAPI) и **frontend** (nginx: лендинг, приложение, прокси `/api` на бэкенд).

## backend
- Root Directory: пусто (корень репозитория) — образу нужны `data/seed`, `data/cache` и снимки демо-полей.
- Variables:
  - `RAILWAY_DOCKERFILE_PATH=backend/Dockerfile.railway`
  - `PORT=8000`
- Публичный домен не нужен. Volume (по желанию, чтобы нарисованные поля не пропадали): путь `/data/fields`.

## frontend
- Root Directory: `/frontend` (там свой `Dockerfile`).
- Variables:
  - `PORT=8080`
  - `BACKEND_URL=http://${{backend.RAILWAY_PRIVATE_DOMAIN}}:8000`
- Networking → Generate Domain, порт 8080.

Имя сервиса бэкенда должно быть ровно `backend` — на него ссылается `BACKEND_URL`.

## Локально
`make up` работает как раньше: docker-compose задаёт фронтенду `PORT=80` и `BACKEND_URL=http://backend:8000`.

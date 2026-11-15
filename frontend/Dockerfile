FROM node:22-slim AS build
WORKDIR /srv/frontend
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
# a template: the nginx image fills in ${PORT} and ${BACKEND_URL} when it starts
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /srv/frontend/dist /usr/share/nginx/html
ENV PORT=80 \
    BACKEND_URL=http://backend:8000 \
    NGINX_ENVSUBST_FILTER=^(PORT|BACKEND_URL)$
EXPOSE 80

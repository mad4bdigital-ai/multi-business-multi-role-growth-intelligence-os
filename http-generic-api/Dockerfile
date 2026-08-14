FROM node:22-slim
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .
ENV NODE_ENV=staging
ENV PORT=8080
# REDIS_URL is supplied by docker-compose at runtime.
CMD ["npm", "start"]

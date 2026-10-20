# EasyContract: one container serving the API and the built web app.
FROM node:22-slim

# Optional local OCR for scanned PDFs: build with --build-arg ENABLE_OCR=1
ARG ENABLE_OCR=0
RUN if [ "$ENABLE_OCR" = "1" ]; then \
      apt-get update && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng poppler-utils \
      && rm -rf /var/lib/apt/lists/*; \
    fi

WORKDIR /app
RUN corepack enable

# Install dependencies first so they are cached between builds.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @easycontract/web build

# Settings only: secrets such as PREVIEW_PASSWORD are set on the host, never here.
ENV NODE_ENV=production \
    WEB_DIST_DIR=/app/apps/web/dist \
    DATA_DIR=/data \
    PORT=3001 \
    OCR_ENABLED=${ENABLE_OCR}
RUN mkdir -p /data
EXPOSE 3001
WORKDIR /app/apps/api
CMD ["node_modules/.bin/tsx", "src/index.ts"]

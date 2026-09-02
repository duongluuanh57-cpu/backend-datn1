# 1. Build Stage
FROM node:22-slim AS builder
WORKDIR /app

# Install build dependencies
COPY package.json package-lock.json* ./
RUN npm ci

# Copy source code and build
COPY . .
RUN npm run build

# 2. Production Runtime Stage
FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000
ENV HOST=0.0.0.0

# Install only production dependencies
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy built bundle from builder
COPY --from=builder /app/dist ./dist

# Non-root user for security
USER node

EXPOSE 4000

CMD ["node", "dist/server.js"]

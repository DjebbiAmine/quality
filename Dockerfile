# Production image for the QualiContact Node/Express application.
# The application serves the frontend and exposes /quality/api/ from the same port.
FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000

# Install only runtime dependencies first for better layer caching.
COPY package.json package-lock.json ./
# RUN npm ci --omit=dev \
#     && npm cache clean --force

# Includes local-api/, local-db/, and the frontend assets.
COPY . .

USER node

EXPOSE 3000

CMD ["npm", "start"]

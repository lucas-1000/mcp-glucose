# Use Node.js LTS
FROM node:20-slim

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including dev for TypeScript build)
RUN npm ci

# Copy application code
COPY . .

# Build TypeScript
RUN npm run build

# Remove dev dependencies after build (keep production small)
RUN npm prune --production

# Expose port
EXPOSE 8080

# Set NODE_ENV
ENV NODE_ENV=production

# Start HTTP server (not stdio server)
CMD ["node", "build/http-server.js"]

FROM node:18-alpine

WORKDIR /app

# Copy package manifests first for efficient Docker layer caching
COPY package*.json ./

# Install production dependencies
RUN npm install --omit=dev

# Copy application source code
COPY . .

# Expose API port
EXPOSE 3000

# Start Express server
CMD ["node", "src/server.js"]

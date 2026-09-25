FROM mcr.microsoft.com/playwright:v1.48.0-jammy

WORKDIR /app

# Install dependencies first for efficient layer caching
COPY package*.json ./
RUN npm install

# Copy application source code, migrations, and configs
COPY tsconfig.json ./
COPY migrations/ ./migrations/
COPY src/ ./src/

# Expose agent port
EXPOSE 3000

# Run in dev mode with ts-node-dev for rapid reload
CMD ["npm", "run", "dev"]

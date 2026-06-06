FROM node:18-alpine

WORKDIR /app

# Install dependencies first for layer caching
COPY package*.json ./
RUN npm install --production

# Copy application code
COPY . .

# Expose port 3000
EXPOSE 3000

# Start server
CMD ["node", "server.js"]

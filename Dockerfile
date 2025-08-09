# Use Node.js oficial
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Install serve to serve static files
RUN npm install -g serve

# Expose port 4000 (evitar conflito com porta 3000)
EXPOSE 4000

# Start the application
CMD ["serve", "-s", "dist", "-l", "4000"]

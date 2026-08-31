# Use Node.js 18 as the base image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy server package files and install
COPY server/package*.json ./server/
RUN cd server && npm install

# Copy client package files and install
COPY client/package*.json ./client/
RUN cd client && npm install

# Copy the rest of the application
COPY . .

# Build the client
RUN npm run build

# Expose port
EXPOSE 5000

# Start the application
CMD ["npm", "run", "railway:start"]

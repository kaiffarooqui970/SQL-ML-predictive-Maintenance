# Use an official Node.js runtime as a parent image
FROM node:20-alpine

# Set the working directory
WORKDIR /app

# Copy package.json and install dependencies
COPY package*.json ./
RUN npm install --legacy-peer-deps

# Copy the rest of your frontend code
COPY . .

# Expose the port Next.js runs on
EXPOSE 3000

# Start the Next.js app in development mode for hot-reloading
CMD ["npm", "run", "dev"]
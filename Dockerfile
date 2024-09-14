# Use Node.js v18.20.4 as the base image
FROM node:18-alpine3.20

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json to install dependencies
COPY package*.json ./

# Install application dependencies
RUN npm install

# Copy the rest of the application code to the container
COPY . .

# Expose the port your app runs on (adjust if different)
EXPOSE 3000

# Define the command to run your app
CMD [ "node", "app.js" ]

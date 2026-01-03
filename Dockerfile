# Use a lightweight Node.js image
FROM node:25-alpine

# Set the working directory
WORKDIR /sandbox

# The sandbox runner expects code to be mounted at /sandbox/src
# and executed via 'node /sandbox/src/<file>'
# No additional setup is required for this simple runner.

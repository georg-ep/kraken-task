FROM node:20-alpine

# Install git for repository cloning via simple-git and build tools for sqlite3
RUN apk add --no-cache git python3 make g++ docker-cli

# Install Gemini CLI for test generation
RUN npm install -g @google/gemini-cli

# Create an isolated toolchain for jest so that ts-jest peer dependencies 
# like jest-util resolve cleanly, which often fails with global installs (-g).
RUN mkdir -p /jest-toolchain && \
    cd /jest-toolchain && \
    npm init -y && \
    npm install jest ts-jest @types/jest typescript
WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

RUN npm run build

EXPOSE 3000

CMD ["npm", "run", "start:prod"]

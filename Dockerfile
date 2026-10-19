# ==========================================
# Stage 1: Build Frontend Assets
# ==========================================
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci || npm install

# Copy source and build static distribution
COPY . .
RUN npm run build

# ==========================================
# Stage 2: Production Nginx Runtime
# ==========================================
FROM nginx:alpine

# Clear default nginx web files
RUN rm -rf /usr/share/nginx/html/*

# Copy built distribution assets
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy custom nginx configuration with reverse proxy & caching rules
COPY nginx/default.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

STOPSIGNAL SIGQUIT

CMD ["nginx", "-g", "daemon off;"]

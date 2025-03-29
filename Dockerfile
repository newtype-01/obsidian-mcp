FROM node:18-alpine

WORKDIR /app

# 复制package.json和package-lock.json
COPY package.json package-lock.json ./

# 安装依赖
RUN npm ci

# 复制源代码
COPY . .

# 构建项目
RUN npm run build

# 设置环境变量
ENV NODE_ENV=production

# 容器启动命令
CMD ["npm", "start"] 
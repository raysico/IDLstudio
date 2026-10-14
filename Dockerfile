# IDL Service Design Studio —— 容器化镜像
# 本地工具；容器内监听 0.0.0.0 以支持 NAS 端口映射；数据持久化到命名卷 /app/data
FROM node:20-alpine

WORKDIR /app

# 依赖锁定，可复现构建（js-yaml）
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# 应用代码（无编译，单阶段即可）
COPY server.js ./
COPY public ./public

# 容器运行参数：绑 0.0.0.0、端口 8010、project.json 落到卷 /app/data
ENV HOST=0.0.0.0 \
    PORT=8010 \
    PROJECT_FILE=/app/data/project.json

VOLUME ["/app/data"]
EXPOSE 8010

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8010/api/health >/dev/null 2>&1 || exit 1

CMD ["node", "server.js"]

# 百度网盘直链解析与下载助手 (Baidu Netdisk Link Resolver & Downloader)

现代化百度网盘无损直链解析与多端极速下载应用，支持浏览器直接下载、Aria2 / Motrix 自动化推送、复制直链及 cURL 命令行导出。具备完善的 Vite 工程化体系与开箱即用的 Docker + Nginx 生产级部署方案。

---

## 🌟 核心功能与特性

1. **双阶段直链解析**：
   - 第一阶段调用 `/api/dupansi` 获取分享文件元数据（文件名、文件大小、资源 ID 等）；
   - 第二阶段调用 `/api/dupan` 提取真实下载直链与专属 User-Agent。
2. **多端下载支持（解除 Motrix 独占）**：
   - **浏览器直接下载**：一键拉起浏览器原生下载；
   - **Motrix / Aria2 推送**：自动注入直链、UA 与文件名至本地或远程 Aria2 RPC，连通性故障友好提示不阻断；
   - **一键复制下载直链**：支持快速复制，方便在 IDM、迅雷或移动端中使用；
   - **一键复制 cURL 命令**：自动携带 `-A "netdisk"` 专属 UA 与文件名，方便 NAS 或服务器下载。
3. **彻底解决 HTTPS 混合内容（Mixed Content）**：
   - 前端所有 API 请求解耦为相对路径 `/api`；
   - 本地开发由 Vite Dev Proxy 转发，生产环境由 Nginx 反向代理至 `http://mxd.indevs.in`，在全站 HTTPS 下零阻断。
4. **轻量现代架构**：
   - 基于原生 ES Modules 与 Vite 构建，Tailwind CSS v4 样式支持；
   - 原生 SPA 微路由与响应式 Proxy 数据绑定，无重型 UI 框架冗余。

---

## 🚀 快速开始

### 1. 本地开发调试

```bash
# 安装依赖
npm install

# 启动本地开发服务器（内置 /api 转发代理）
npm run dev
```

浏览器访问 `http://localhost:5173` 即可开始开发与调试。

### 2. 自动化测试

```bash
# 运行单元测试与反代规则校验
npm test
```

### 3. 生产打包

```bash
# 编译生产环境静态产物至 dist/ 目录
npm run build

# 本地预览编译后的静态站点
npm run preview
```

---

## 🐳 Docker & 服务器一键部署

本仓库提供了基于多阶段构建的 `Dockerfile` 与 `docker-compose.yml`，并集成了 GitHub Actions 自动构建多架构 Docker 镜像推送至 GHCR。

### 方式 A：1Panel 容器编排一键部署（推荐）

1. 登录 1Panel 管理面板，进入 **「容器」** -> **「编排」** -> 点击 **「创建编排」**；
2. 编排名称填写 `baidupan-resolver`；
3. 在 Compose 内容框中粘贴以下 YAML 配置（端口可根据实际需要修改）：

```yaml
services:
  baidupan-web:
    image: ghcr.io/sakiko15/baidupan-resolver:latest
    container_name: baidupan-resolver
    restart: unless-stopped
    ports:
      - "8080:80"
    environment:
      - TZ=Asia/Shanghai
```

4. 点击 **「确认」**，1Panel 将自动拉取镜像并启动容器；
5. （可选）在 1Panel **「网站」** 中添加反向代理，代理地址填写 `http://127.0.0.1:8080`，并一键申请 Let's Encrypt SSL 证书实现 HTTPS 访问。

### 方式 B：本地 Docker Compose 部署（源码自编译）
```bash
# 启动容器（后台运行，映射宿主机 8080 端口）
docker compose up -d --build

# 查看运行状态
docker compose ps

# 查看访问日志
docker compose logs -f
```

部署完成后，在浏览器中访问 `http://<服务器IP>:8080` 即可使用。

### 方式 C：单独构建 Docker 镜像

```bash
docker build -t baidupan-resolver:latest .
docker run -d --name baidupan-web -p 8080:80 --restart unless-stopped baidupan-resolver:latest
```

### 方式 D：传统 Nginx 宿主机部署

若直接使用宿主机现有的 Nginx：
1. 本地或 CI 执行 `npm run build`，将生成的 `dist/` 目录内容上传至服务器 `/usr/share/nginx/html`；
2. 将 `nginx/default.conf` 中的反向代理与静态资源配置合并至你的 Nginx 虚拟主机配置中；
3. 执行 `nginx -s reload` 生效。

---

## 📁 目录结构

```
.
├── src/                         # 源码目录
│   ├── main.js                  # 应用入口与交互逻辑控制
│   ├── api.js                   # 解析接口客户端与相对路径封装
│   ├── aria2.js                 # Aria2 / Motrix JSON-RPC 集成与配置弹窗
│   ├── router.js                # 原生 SPA 微路由器
│   ├── utils.js                 # 核心工具库（加解密、模板、剪贴板、弹窗、Toast）
│   └── style.css                # Tailwind CSS v4 与自定义样式
├── tests/
│   └── verify.test.js           # 自动化测试用例集
├── nginx/
│   └── default.conf             # 生产环境 Nginx 反向代理与缓存配置
├── index.html                   # 应用入口骨架
├── home.html                    # 首页视图与文件列表模板
├── Dockerfile                   # 多阶段容器构建定义
├── docker-compose.yml           # 容器编排配置
├── vite.config.js               # Vite 构建与反代配置
└── package.json                 # 项目依赖与脚本配置
```

---

## ⚠️ 使用规范与注意事项

1. **必须先转存再分享**：服务端不支持直接解析他人的原始分享链接，必须先保存到自己的网盘并创建公开分享。
2. **仅支持顶层文件**：解析接口仅遍历分享链接根目录的文件；所有子目录及其内部文件会被直接忽略。
3. **频次配额限制**：服务端限制每个标识每小时大约解析 **5 个文件**，解析标识每小时自动解绑刷新。
4. **Motrix / Aria2 RPC 配置**：在首页「打开」按钮上点击**鼠标右键**，可自定义本地或远程 Aria2 RPC 地址与密钥。

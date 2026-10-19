# 百度网盘直链解析与下载助手 (Baidu Netdisk Link Resolver & Downloader)

现代化百度网盘无损直链解析与多端极速下载应用，支持浏览器直接下载、Aria2 / Motrix 自动化推送、复制直链及 cURL 命令行导出。具备完善的 Vite 工程化体系与开箱即用的 Docker + Nginx 生产级部署方案。

---

## 🌟 核心功能与特性

1. **双阶段直链解析**：
   - 第一阶段调用 `/api/dupansi` 获取分享文件元数据（文件名、文件大小、资源 ID 等）；
   - 第二阶段调用 `/api/dupan` 提取真实下载直链与专属 User-Agent。
2. **多端下载支持（解除 Motrix 独占）**：
   - **Motrix / Aria2 推送（推荐）**：自动注入直链、`netdisk` UA 与文件名至本地或远程 Aria2 RPC，连通性故障友好提示，避免 31362 签名错误；
   - **浏览器直接下载**：内置 31362 sign error 防护提示与 UA 一键复制；
   - **一键复制下载直链与专属 UA**：支持快速复制，方便在 IDM、迅雷或移动端中配置 `netdisk` User-Agent；
   - **一键复制 cURL / IDM 命令**：自动携带 `-A "netdisk"` 专属 UA 与文件名，方便 NAS、终端或 IDM 高速下载。
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

---

## 💡 常见问题与下载指南 (FAQ)

### Q: 为什么在浏览器中直接下载会报错 `{"error_code":31362,"error_msg":"sign error"}`？

**原理解析**：
百度网盘对生成的 PCS 直链实施了严格的**防盗链与客户端 User-Agent 校验机制**。直链必须在请求头中携带特定的 `User-Agent: netdisk`（或 `pan.baidu.com`），百度直链服务器才会放行数据流：
- **为什么 Motrix / Aria2 可以正常下载？**
  本工具在调用 Motrix / Aria2 JSON-RPC 接口（`aria2.addUri`）时，自动注入了 `'user-agent': 'netdisk'` 请求头配置，因此 Motrix 下载完全不受影响且支持多线程高速断点续传。
- **为什么浏览器直接点击会报错？**
  根据 W3C 安全规范（Forbidden Header Name），现代浏览器出于跨站安全考虑，禁止网页前端 JavaScript 或原生 `<a>` 标签自定义或修改 HTTP `User-Agent`（默认为浏览器的 `Mozilla/5.0 ...`）。百度直链服务器接收到非 `netdisk` 的 User-Agent 请求后，判定直链签名与客户端特征不匹配，返回 HTTP 403 / 错误码 `31362`。

---

### 推荐的 4 种下载方案操作指南

#### 方案一（强烈推荐）：Motrix / Aria2 本地客户端一键下载
- **特点**：零门槛、自动注入 `netdisk` UA、无需手动复制、支持多线程极速下载与断点续传。
- **操作步骤**：
  1. 打开本地运行的 [Motrix](https://motrix.app/)（默认 RPC 地址 `http://localhost:16800/jsonrpc`，免密）；
  2. 在文件列表或下载选项弹窗中点击 **「推送到 Motrix / Aria2」**；
  3. 任务即刻进入 Motrix 下载队列。
- **提示**：若使用自定义 Aria2 服务端，可在网页「打开」按钮上**点击鼠标右键**配置 RPC 地址与访问 Token。

#### 方案二：IDM / FDM 等专业多线程下载器
- **特点**：单文件极速、支持定时下载与批量抓取。
- **操作步骤**：
  1. 在网页弹窗中点击 **「复制直链」** 与 **「复制 UA」**（或点击 **「复制 IDM 参数」**）；
  2. 打开 IDM，进入 **「选项」** -> **「下载」** 中，将默认下载 User-Agent 修改为 `netdisk`；
  3. 或者直接在终端/运行窗口执行复制的 IDM 命令：`idman /d "直链" /f "文件名"`。

#### 方案三：浏览器安装 User-Agent 切换插件
- **特点**：无需打开外部客户端，继续享受浏览器原生下载体验。
- **操作步骤**：
  1. 在浏览器应用商店中安装 `User-Agent Switcher and Manager` 或类似扩展；
  2. 在扩展中添加自定义规则：将目标域名为 `*.baidupcs.com` 的请求，其 `User-Agent` 规则重写为 `netdisk`；
  3. 配置完成后，即可直接在页面中点击「浏览器直接下载」畅快拉取。

#### 方案四：终端 cURL 命令行导出
- **特点**：适合 Linux 服务器、软路由、群晖/威联通 NAS 或无 GUI 生产环境。
- **操作步骤**：
  1. 在下载选项弹窗中点击 **「复制 cURL 命令」**；
  2. 在终端粘贴运行，命令已自动包含 `-L`（跟随重定向）、`-A "netdisk"`（伪装网盘客户端）及安全转义的文件名：
     ```bash
     curl -L -A "netdisk" -o "文件名.mp4" "https://d.pcs.baidu.com/file/..."
     ```

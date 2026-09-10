# AIStudioToAPI Build Proxy

本项目将 Google AI Studio Build 网页端转换为本地 OpenAI、Gemini 和 Anthropic 兼容接口。服务启动后由后台浏览器维持 Build 连接，客户端无需打开 AI Studio 页面。

## 项目来源

本项目基于 [iBUHub/AIStudioToAPI](https://github.com/iBUHub/AIStudioToAPI) 改良。上游项目提供 Build 页面自动化、请求转换、流式响应、账号切换和 Web 控制台等核心能力。本项目保留 MIT License，详见 [LICENSE](LICENSE)。

## 子项目

认证文件生成器已经独立为 [auth-exporter](./auth-exporter/)。

- 主项目：反代服务、认证文件读取、管理界面上传和下载。
- `auth-exporter`：只在需要新增账号时于电脑运行，生成 `auth-N.json`。
- 两个项目拥有独立的配置、依赖、浏览器目录、日志和认证文件目录。
- 手机 Termux 只安装和运行主项目，不需要安装认证生成器。

## 工作流程

```text
电脑运行 auth-exporter
  → 生成 auth-exporter/configs/auth/auth-0.json
  → 将 JSON 复制到手机
  → 手机启动本项目
  → 管理页面上传认证文件
  → 后台自动加载并连接 Build
```

## Windows 快速开始

要求：Node.js 18+、npm，以及能够访问 Google 的网络环境。

启动主服务：

```powershell
Copy-Item .env.example .env
notepad .env
.\setup.ps1
npm start
```

`.env` 至少设置：

```env
PORT=13100
HOST=127.0.0.1
API_KEYS=设置一个本地访问密码
```

服务地址：`http://127.0.0.1:13100/`

生成认证文件（可选）：

```powershell
cd auth-exporter
Copy-Item .env.example .env
npm install
npm run auth
```

认证文件会生成在 `auth-exporter/configs/auth/auth-0.json`。回到主项目管理页面，点击“添加账号/上传认证文件”导入即可。

## Linux / macOS

启动主服务：

```bash
cp .env.example .env
nano .env
npm install
npm start
```

生成认证文件：

```bash
cd auth-exporter
cp .env.example .env
npm install
npm run auth
```

## Termux

Termux 只运行主项目，不要求 Google 登录浏览器、X11、VNC 或认证生成器：

```bash
pkg update
pkg install -y git
git clone <你的仓库地址>
cd build-executor
bash setup-termux.sh
npm start
```

打开 `http://127.0.0.1:13100/`，登录管理页面后上传电脑生成的 `auth-N.json`。导入成功后账号会自动加载，不需要重启服务。

## 管理界面

管理页面提供认证文件上传、单个下载、批量下载、账号状态查看、账号删除和运行统计。管理页面使用 `API_KEYS` 或 `WEB_CONSOLE_PASSWORD` 保护，不要将管理端口直接暴露到公网。

## API 示例

```bash
curl http://127.0.0.1:13100/v1/chat/completions \
  -H "Authorization: Bearer 你的API_KEYS" \
  -H "Content-Type: application/json" \
  -d '{"model":"gemini-3.5-flash","messages":[{"role":"user","content":"Hi"}]}'
```

## 重要配置

| 变量                         | 说明                                   |
| ---------------------------- | -------------------------------------- |
| `PORT`                       | HTTP 端口，默认 `13100`                |
| `HOST`                       | 监听地址，默认 `127.0.0.1`             |
| `API_KEYS`                   | 本地 API 和管理页面访问密码            |
| `MAX_CONTEXTS`               | 同时运行的账号上下文数量               |
| `INITIAL_AUTH_INDEX`         | 默认账号编号                           |
| `SWITCH_ON_USES`             | 达到指定请求数后切换账号，`0` 表示关闭 |
| `FAILURE_THRESHOLD`          | 连续失败后切换账号的阈值               |
| `HTTP_PROXY` / `HTTPS_PROXY` | 访问 Google 的代理                     |

## 安全说明

`auth-N.json` 包含 Google 登录会话凭证，必须按密码保护：

- 不要提交 `.env`、`configs/auth/`、`auth-exporter/configs/auth/` 或浏览器缓存；
- 不要把认证文件发送给他人或上传到 GitHub；
- 只通过本地或受信任的管理页面传输；
- 凭证失效后，在电脑端重新运行 `auth-exporter` 生成文件，再从管理页面替换。

## License

MIT，具体以 [LICENSE](./LICENSE) 为准。

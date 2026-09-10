# AIStudioToAPI Build 反代（本地改良版）

将 Google AI Studio Build 网页端转换为本地 OpenAI、Gemini 和 Anthropic 兼容 API。首次完成 Google 账号登录后，服务会在后台维护浏览器会话，日常使用不需要一直打开 AI Studio 页面。

## 来源与许可证

本项目基于 [iBUHub/AIStudioToAPI](https://github.com/iBUHub/AIStudioToAPI) 构建。上游仓库负责 Build 页面自动化、认证文件、请求转换、流式响应、账号切换和 Web 控制台等核心能力。

本项目保留上游 MIT License，并在此基础上做本地化改良。版权和许可证信息见 [LICENSE](LICENSE)。

## 本项目的改良内容

- 默认监听地址改为 `127.0.0.1:13100`，适合本机程序调用，避免默认暴露到局域网。
- 增加 `setup.ps1`、`start.ps1`、`start.cmd`，简化 Windows 安装和启动。
- 增加 `setup-termux.sh`、`start.sh`，提供 Termux 启动入口。
- 统一使用项目根目录的 `.env`、`configs/auth/` 和 `data/`，便于备份和迁移。
- 保留上游 Build 模型配置，包括 `gemini-3.5-flash`、`gemini-3.6-flash`、`gemini-3.7-flash` 和 `gemini-3.8-flash`。
- 本地接口鉴权使用 `API_KEYS`，与 Google API Key 分离。
- 补充适合本地部署的快速开始、认证文件和安全说明。

核心 Build 反代协议没有被改写为普通 Gemini API；实际请求仍由后台浏览器访问 AI Studio Build。

## 工作方式

```text
客户端（OpenAI SDK / SillyTavern / curl）
        ↓
本地 Express API（127.0.0.1:13100）
        ↓
后台 Playwright / Camoufox 浏览器
        ↓
Google AI Studio Build
```

认证状态保存在 `configs/auth/`。Google 登录凭证可能过期，过期后只需重新执行一次认证流程。

## Windows 快速开始

要求：Node.js 18 或更高版本、npm，以及能够访问 Google 的网络环境。

### 1. 创建配置

PowerShell：

```powershell
Copy-Item .env.example .env
notepad .env
```

至少修改：

```env
PORT=13100
HOST=127.0.0.1
API_KEYS=你自己的本地访问密码
```

`API_KEYS` 只是本地 API 密码，不是 Google API Key。

### 2. 安装依赖并登录

```powershell
npm install
npm run setup-auth
```

浏览器窗口打开后，登录 Google 账号并按提示保存认证信息。认证文件应出现在：

```text
configs/auth/auth-0.json
```

### 3. 启动服务

```powershell
npm start
```

以后可以直接运行：

```powershell
.\start.ps1
```

或者双击/命令行运行：

```cmd
start.cmd
```

控制台和 API 地址：

```text
http://127.0.0.1:13100
```

## Linux / macOS 快速开始

```bash
cp .env.example .env
nano .env
npm install
npm run setup-auth
npm start
```

快速重启可以使用：

```bash
npm run quick-start
```

## Termux 快速开始

Termux 方案依赖 Android 设备上的 Node.js、浏览器和图形环境，兼容性取决于设备。建议使用 Termux:X11 或 VNC 完成首次登录。

```bash
pkg update
pkg install -y git
git clone <你的仓库地址>
cd build-executor
bash setup-termux.sh
```

编辑配置：

```bash
nano .env
```

确认：

```env
PORT=13100
HOST=127.0.0.1
API_KEYS=你自己的本地访问密码
```

首次认证：

```bash
npm run setup-auth
```

启动：

```bash
./start.sh
```

如果脚本没有执行权限：

```bash
chmod +x setup-termux.sh start.sh
```

## API 调用示例

### 查看模型

```bash
curl http://127.0.0.1:13100/v1/models \
  -H "Authorization: Bearer 你设置的API_KEYS"
```

### OpenAI 兼容接口

```bash
curl http://127.0.0.1:13100/v1/chat/completions \
  -H "Authorization: Bearer 你设置的API_KEYS" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-3.5-flash",
    "messages": [{"role": "user", "content": "Hi"}],
    "stream": false
  }'
```

Python OpenAI SDK：

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:13100/v1",
    api_key="你设置的API_KEYS",
)

result = client.chat.completions.create(
    model="gemini-3.5-flash",
    messages=[{"role": "user", "content": "Hi"}],
)
print(result.choices[0].message.content)
```

### Gemini 原生接口

```bash
curl http://127.0.0.1:13100/v1beta/models/gemini-3.5-flash:generateContent \
  -H "x-goog-api-key: 你设置的API_KEYS" \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [{"role": "user", "parts": [{"text": "Hi"}]}]
  }'
```

## 常用配置

| 变量                         | 说明                                                        |
| ---------------------------- | ----------------------------------------------------------- |
| `PORT`                       | 本地 HTTP 端口，默认改为 `13100`                            |
| `HOST`                       | 监听地址，默认改为 `127.0.0.1`                              |
| `API_KEYS`                   | 本地 API 访问密码，支持逗号分隔多个 key                     |
| `MAX_CONTEXTS`               | 同时保持的账号浏览器上下文数量                              |
| `INITIAL_AUTH_INDEX`         | 启动时使用的认证账号编号                                    |
| `STREAMING_MODE`             | `real` 真流式，`fake` 假流式                                |
| `MAX_RETRIES`                | 请求失败后的重试次数                                        |
| `SWITCH_ON_USES`             | 达到指定请求数后切换到下一个账号；设为 `0` 可关闭按次数切换 |
| `FAILURE_THRESHOLD`          | 连续失败达到指定次数后切换账号                              |
| `HTTP_PROXY` / `HTTPS_PROXY` | 访问 Google 所需的代理                                      |
| `CAMOUFOX_EXECUTABLE_PATH`   | 手动安装 Camoufox 时填写浏览器路径                          |

## 安全注意事项

- 不要提交 `.env`、`configs/auth/`、`data/` 或浏览器缓存。
- 不要把 `HOST` 改成 `0.0.0.0` 后直接暴露到公网，除非额外配置 HTTPS、反向代理和访问控制。
- `API_KEYS` 是本地服务密码，应设置为随机字符串。
- `configs/auth/` 中包含 Google 登录凭证，必须当作密码保护。
- 本项目不会要求 Google Cloud Gemini API Key；它使用 AI Studio Build 的登录会话。

## 更新上游代码

本项目是上游仓库的本地改良版。更新时应先阅读上游变更，再决定是否手动合并，尤其注意：

- `src/core/BrowserManager.js`
- `src/core/RequestHandler.js`
- `src/auth/`
- `src/utils/ConfigLoader.js`
- `configs/models.json`

不要直接覆盖 `.env` 或 `configs/auth/`。

## 致谢

- [iBUHub/AIStudioToAPI](https://github.com/iBUHub/AIStudioToAPI)
- Google AI Studio

## License

MIT，具体以 [LICENSE](LICENSE) 为准。

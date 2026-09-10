# Build Auth Exporter

这是独立的电脑端认证文件生成器，用于登录 Google AI Studio 并生成主反代服务可以导入的 `auth-N.json`。

主项目不会调用本子项目；本子项目也不会读取或写入主项目目录。认证文件、配置、依赖、Camoufox、日志和临时文件都位于本目录内。

## 安装

Windows PowerShell：

```powershell
cd auth-exporter
Copy-Item .env.example .env
npm install
```

Linux / macOS：

```bash
cd auth-exporter
cp .env.example .env
npm install
```

## 生成认证文件

```bash
npm run auth
```

浏览器打开后完成 Google AI Studio 登录。认证文件会生成在：

```text
auth-exporter/configs/auth/auth-0.json
```

重复运行会自动生成下一个编号。批量模式：

```bash
npm run auth:batch
```

生成完成后，将 JSON 文件复制到运行主项目的设备，再从主项目管理页面上传。

## 可选配置

配置文件为 `auth-exporter/.env`：

```env
HTTPS_PROXY=http://127.0.0.1:7890
HTTP_PROXY=http://127.0.0.1:7890
CAMOUFOX_EXECUTABLE_PATH=
```

无界面模式：

```bash
npm run auth -- --headless
```

无界面模式可能无法处理 Google 的验证码、二次验证或人工确认，优先使用普通有界面模式。

## 输出目录

```text
auth-exporter/
├─ configs/auth/       # 生成的认证文件
├─ camoufox*/          # 认证工具使用的浏览器
├─ logs/               # 可选调试输出
├─ users.csv           # 可选批量账号输入
├─ .env                # 本地配置
└─ node_modules/       # 子项目依赖
```

## 导入主项目

1. 复制 `configs/auth/auth-N.json` 到手机或服务器；
2. 启动主项目；
3. 打开主项目管理页面；
4. 点击“添加账号/上传认证文件”；
5. 选择 JSON 文件；
6. 等待账号状态变为可用。

主项目支持单个下载和批量下载认证文件，下载后的文件可以再次导入其他设备。

## 安全要求

认证文件包含 Google 登录会话凭证：

- 不要提交到 Git；
- 不要上传到公共网盘或发送给他人；
- 不要把文件内容粘贴到聊天、Issue 或日志中；
- 使用完成后及时删除临时副本；
- 发现泄露时立即在 Google 账号中撤销相关会话。

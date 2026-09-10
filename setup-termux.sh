#!/data/data/com.termux/files/usr/bin/bash
set -e
cd "$(dirname "$0")"
if ! pkg install -y nodejs chromium; then
  cat >&2 <<'EOF'

Termux 的系统包配置失败，尚未执行本项目的 npm 安装。
错误通常表示 python-pip 被破坏，导致 lv2/pipewire/chromium 无法完成配置。
请先在 Termux 中执行：

  pkg update
  pkg install --reinstall python-pip
  dpkg --configure -a
  apt --fix-broken install
  pkg install -y nodejs chromium

不要使用 pip install --upgrade pip 修复 Termux 系统 pip，这可能破坏 Termux 的 python-pip 包。
EOF
  exit 1
fi
if [ ! -f .env ]; then cp .env.example .env; fi
npm install
printf '\n依赖安装完成。现在可以运行 npm start 启动服务。\n'

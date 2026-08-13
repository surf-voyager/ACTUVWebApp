#!/usr/bin/env sh

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR" || exit 1

if ! command -v node >/dev/null 2>&1; then
    printf '%s\n' '[ACTUV启动器] 未找到 Node.js。请安装 Node.js 20.19+ 或 22.12+ 后重试。' >&2
    exit 1
fi

exec node scripts/startFrontend.mjs

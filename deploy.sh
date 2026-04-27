#!/bin/bash
# deploy.sh - VCC (huifu) 部署脚本
#
# 用法:
#   bash /opt/huifu/deploy.sh [branch]
#
# 参数:
#   branch  - 要部署的 Git 分支（默认: main）
#
# 前置条件:
#   - 以 ubuntu 用户运行（不要用 sudo bash，否则 PM2 查不到进程）
#   - ubuntu 用户有 NOPASSWD sudo 权限
#   - PM2 进程 vcc-server 已注册
#   - Nginx 已配置完成
#
# 部署流程（6 步）:
#   1. git pull 拉取最新代码
#   2. server: npm run build (tsc)
#   3. client: npm run build (vite)
#   4. admin:  npm run build (vite)
#   5. 同步 dist 到 Nginx webroot
#   6. 重启 PM2 + Nginx

set -e

BRANCH="${1:-main}"
HUIFU_DIR="/opt/huifu"
WEBROOT_CLIENT="/var/www/cardgolink"
WEBROOT_ADMIN="/var/www/admin-cardgolink"
PM2_PROCESS="vcc-server"

echo ""
echo "========================================="
echo " [DEPLOY] 开始部署 huifu (VCC) - 分支: $BRANCH"
echo "========================================="
echo ""

# ── Step 1: 拉取代码 ──────────────────────────────────
echo "[DEPLOY] [1/6] 拉取代码 (git pull origin $BRANCH)..."
cd "$HUIFU_DIR"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull origin "$BRANCH"
echo "[DEPLOY]       当前 commit: $(git rev-parse --short HEAD)"
echo ""

# ── Step 2: 构建 server ──────────────────────────────
echo "[DEPLOY] [2/6] 构建 server (tsc)..."
cd "$HUIFU_DIR/server"
npm install --no-audit --no-fund 2>&1 | tail -1
npm run build
echo "[DEPLOY]       server tsc ✅"
echo ""

# ── Step 3: 构建 client ──────────────────────────────
echo "[DEPLOY] [3/6] 构建 client (vite)..."
cd "$HUIFU_DIR/client"
npm install --no-audit --no-fund 2>&1 | tail -1
npm run build
echo "[DEPLOY]       client vite ✅"
echo ""

# ── Step 4: 构建 admin ───────────────────────────────
echo "[DEPLOY] [4/6] 构建 admin (vite)..."
cd "$HUIFU_DIR/admin"
npm install --no-audit --no-fund 2>&1 | tail -1
npm run build
echo "[DEPLOY]       admin vite ✅"
echo ""

# ── Step 5: 同步前端到 Nginx webroot ────────────────
echo "[DEPLOY] [5/6] 同步前端到 Nginx..."
sudo rm -rf "${WEBROOT_CLIENT:?}/*"
sudo rm -rf "${WEBROOT_ADMIN:?}/*"
sudo cp -r "$HUIFU_DIR/client/dist/." "$WEBROOT_CLIENT/"
sudo cp -r "$HUIFU_DIR/admin/dist/." "$WEBROOT_ADMIN/"
sudo chown -R www-data:www-data "$WEBROOT_CLIENT" "$WEBROOT_ADMIN"
echo "[DEPLOY]       client → $WEBROOT_CLIENT ✅"
echo "[DEPLOY]       admin  → $WEBROOT_ADMIN ✅"
echo ""

# ── Step 6: 重启 PM2 + Nginx ────────────────────────
echo "[DEPLOY] [6/6] 重启 PM2 + Nginx..."
cd "$HUIFU_DIR"
pm2 restart "$PM2_PROCESS"
pm2 status "$PM2_PROCESS"
sudo nginx -t 2>&1
sudo systemctl reload nginx
echo "[DEPLOY]       PM2 $PM2_PROCESS restarted ✅"
echo "[DEPLOY]       Nginx reloaded ✅"
echo ""

echo "========================================="
echo " [DEPLOY] 部署完成 ✅"
echo "========================================="
echo ""

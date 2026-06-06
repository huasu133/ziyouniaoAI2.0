#!/bin/bash
# 自由鸟AI 3.0 — 部署 10 个 Agent 到 OpenClaw
# 用法: bash deploy-experts.sh

set -e

EXPERTS_SRC="/Users/songmoxin/WorkBuddy/2026-06-05-11-48-17/ziyouniao-v4/experts"
WORKSPACE_BASE="$HOME/.openclaw"

echo "=== 部署 10 个 Agent ==="

deploy_agent() {
  local id=$1
  local soul_file="$EXPERTS_SRC/$id.soul.md"
  local workspace="$WORKSPACE_BASE/workspace-$id"
  local skills="$2"

  echo ""
  echo "▶ $id"

  # 1. 创建 Agent 工作区
  openclaw agents add "$id" --workspace "$workspace" --model deepseek/deepseek-v4-flash 2>/dev/null || echo "   Agent $id 已存在，跳过创建"
  mkdir -p "$workspace"

  # 2. 部署 SOUL.md
  cp "$soul_file" "$workspace/SOUL.md"
  echo "   SOUL.md 已部署"

  # 3. 分配技能
  openclaw config set "agents.$id.skills" "$skills"
  echo "   技能已分配: $skills"
}

# ─── 部署 10 个 Agent ───

deploy_agent "architect" "coding-agent,taskflow,diagram-maker"
deploy_agent "fe-dev" "coding-agent,canvas,node-inspect-debugger"
deploy_agent "electron" "coding-agent,spike,node-inspect-debugger"
deploy_agent "db" "coding-agent,model-usage"
deploy_agent "security" "oracle,healthcheck,node-connect,session-logs"
deploy_agent "payment" "coding-agent,spike,taskflow"
deploy_agent "devops" "github,gh-issues,healthcheck,node-connect"
deploy_agent "content" "coding-agent,summarize"
deploy_agent "seo" "summarize,spike"
deploy_agent "data" "summarize,model-usage"

echo ""
echo "=== 全部部署完成 ==="

# 4. 重启网关
openclaw gateway restart
echo "网关已重启"

#!/usr/bin/env bash
# Quick restart: kill → build → launch (all silent)
echo "Killing server..."
for pid in $(netstat -ano 2>/dev/null | grep ":8787.*LISTEN" | awk '{print $5}' | sort -u); do
  /c/Windows/System32/taskkill.exe //F //PID "$pid" > /dev/null 2>&1
done
sleep 1
echo "Building frontend..."
cd "$(dirname "$0")" && npx vite build > logs/vite-build.log 2>&1
echo "Starting server..."
cd api && python server.py > ../logs/api-server.log 2>&1 &
sleep 2
curl -sf http://localhost:8787/api/health > /dev/null && echo "Dashboard ready: http://localhost:8787" || echo "Server failed to start — check logs/api-server.log"

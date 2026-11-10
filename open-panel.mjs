#!/usr/bin/env node
/**
 * open-panel.mjs — 找到 DSH 本地 Web 服务并打开排队限速面板
 *
 * 桌面端每次启动的端口可能不同，所以这里直接扫「DSH 进程正在监听的 loopback 端口」，
 * 逐个探测 /api/llm-queue/state，命中就打开浏览器。
 *
 * 用法：node open-panel.mjs [--print]   （--print 只输出地址不打开）
 */

import { execFileSync } from 'node:child_process';

const printOnly = process.argv.includes('--print');

function listeningPorts() {
  const ports = new Set();
  let out = '';
  try {
    out = execFileSync('netstat', ['-ano'], { encoding: 'utf8', windowsHide: true });
  } catch {
    return [];
  }
  for (const line of out.split(/\r?\n/)) {
    const match = line.match(/^\s*TCP\s+(127\.0\.0\.1|\[::1\]|0\.0\.0\.0):(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i);
    if (match) ports.add({ port: Number(match[2]), pid: Number(match[3]) });
  }
  return [...ports];
}

function dshPids() {
  const pids = new Set();
  try {
    const out = execFileSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true });
    for (const line of out.split(/\r?\n/)) {
      const cells = line.split('","').map((cell) => cell.replace(/^"|"$/g, ''));
      if (cells.length < 2) continue;
      if (/deepseek harness|dsh/i.test(cells[0])) pids.add(Number(cells[1]));
    }
  } catch {
    return pids;
  }
  return pids;
}

async function probe(port) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1200);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/llm-queue/state`, { signal: controller.signal });
    if (!res.ok) return null;
    const body = await res.json();
    if (!Array.isArray(body.lanes)) return null;
    return { port, lanes: body.lanes.length };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const pids = dshPids();
const portIndex = process.argv.indexOf('--port');
const forcedPort = portIndex >= 0 ? Number(process.argv[portIndex + 1]) : undefined;
const candidates = forcedPort
  ? [{ port: forcedPort }]
  : listeningPorts().filter((item) => pids.size === 0 || pids.has(item.pid));
const unique = [...new Set(candidates.map((item) => item.port))];

for (const port of unique) {
  const hit = await probe(port);
  if (!hit) continue;
  const url = `http://127.0.0.1:${port}/llm-queue`;
  console.log(url);
  if (!printOnly) {
    try {
      execFileSync('cmd', ['/c', 'start', '', url], { windowsHide: true, stdio: 'ignore' });
    } catch {
      console.log('（自动打开失败，请手动访问上面的地址）');
    }
  }
  process.exit(0);
}

console.error('没找到带 llm-queue 面板的 DSH 实例。请确认：1) DSH 已安装并重启过本插件 2) 正在运行');
process.exit(1);

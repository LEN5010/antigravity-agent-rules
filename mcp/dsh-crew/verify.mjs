#!/usr/bin/env node
/**
 * dsh-crew 端到端验收：用与 Antigravity 注册完全相同的命令行起 MCP server，
 * 走 initialize / tools/list / tools/call(dsh_status) / tools/call(dsh_ask) / tools/call(dsh_sessions)。
 *
 * 用法：
 *   node verify.mjs            # 全量（会真的跑两次 DSH，耗 token）
 *   node verify.mjs --offline  # 只验协议与自检，不启动 DSH
 *
 * 可用环境变量：
 *   DSH_CREW_WORKSPACE  指定 DSH 工作区（默认本进程 cwd）
 *   DSH_CREW_DSH_CMD    指定 DSH 启动器；不设则靠桥自动探测
 */
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OFFLINE = process.argv.includes('--offline');
const NODE = process.env.DSH_CREW_NODE || process.execPath;
const BRIDGE = path.join(HERE, 'dsh-crew.mjs');
const CWD = process.env.DSH_CREW_WORKSPACE || process.cwd();

console.log('node:   ' + NODE + ' (' + process.version + ')');
console.log('bridge: ' + BRIDGE);
console.log('cwd:    ' + CWD);
console.log('home:   ' + os.homedir());
console.log('模式:   ' + (OFFLINE ? 'offline（不启动 DSH）' : 'full（会真实调用 DSH）') + '\n');

const child = spawn(NODE, [BRIDGE, 'mcp'], {
  cwd: CWD,
  env: Object.assign({}, process.env, { DSH_CREW_WORKSPACE: CWD }),
  stdio: ['pipe', 'pipe', 'pipe'],
});

let buf = '';
const waiters = new Map();
const stderrChunks = [];

child.stdout.setEncoding('utf8');
child.stdout.on('data', (c) => {
  buf += c;
  const lines = buf.split(/\r?\n/);
  buf = lines.pop() || '';
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    let msg;
    try { msg = JSON.parse(t); } catch { console.log('[non-json stdout] ' + t.slice(0, 200)); continue; }
    if (msg.id !== undefined && msg.id !== null && waiters.has(msg.id)) {
      const w = waiters.get(msg.id);
      waiters.delete(msg.id);
      w(msg);
    }
  }
});
child.stderr.setEncoding('utf8');
child.stderr.on('data', (c) => stderrChunks.push(c));

let nextId = 1;
function request(method, params, timeoutMs = 600000) {
  const id = nextId++;
  const msg = { jsonrpc: '2.0', id, method };
  if (params !== undefined) msg.params = params;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiters.delete(id);
      reject(new Error('timeout waiting for ' + method));
    }, timeoutMs);
    waiters.set(id, (resp) => { clearTimeout(timer); resolve(resp); });
    child.stdin.write(JSON.stringify(msg) + '\n');
  });
}
function notify(method, params) {
  const msg = { jsonrpc: '2.0', method };
  if (params !== undefined) msg.params = params;
  child.stdin.write(JSON.stringify(msg) + '\n');
}
const textOf = (resp) => (resp.result && resp.result.content ? resp.result.content.map((c) => c.text || '').join('\n') : JSON.stringify(resp.error || resp.result));

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log((pass ? 'PASS ' : 'FAIL ') + name + ' :: ' + String(detail).replace(/\s+/g, ' ').slice(0, 300));
}

try {
  // 1. 握手
  const init = await request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'antigravity-verify', version: '0.0.1' },
  }, 30000);
  record('initialize', !!init.result && init.result.serverInfo && init.result.serverInfo.name === 'dsh-crew',
    JSON.stringify(init.result && init.result.serverInfo));
  notify('notifications/initialized');

  // 2. 工具清单
  const list = await request('tools/list', {}, 30000);
  const names = ((list.result && list.result.tools) || []).map((t) => t.name).sort();
  record('tools/list', names.length === 4 && names.includes('dsh_ask'), names.join(','));

  // 3. 自检
  const status = await request('tools/call', { name: 'dsh_status', arguments: {} }, 60000);
  const statusText = textOf(status);
  const statusOk = OFFLINE
    ? statusText.includes('dsh_launcher') && statusText.includes('dsh_cmd_configured')
    : statusText.includes('"ready": true');
  record('tools/call dsh_status', !!(status.result && !status.result.isError) && statusOk, statusText.slice(0, 400));

  if (OFFLINE) {
    record('skip real DSH run', true, '--offline：未启动 DSH');
  } else {
    // 4. 真派一个任务给 DSH（read-only，快速）
    const ask = await request('tools/call', {
      name: 'dsh_ask',
      arguments: {
        task: '用一句话回答：dsh-crew 桥接验收，请回复「crew-ok」并附上当前工作目录。不要修改任何文件。',
        session: 'verify',
        permission: 'read-only',
        timeout_ms: 300000,
      },
    }, 420000);
    const askText = textOf(ask);
    record('tools/call dsh_ask (real DSH run)', !!ask.result && !ask.result.isError && /crew-ok/i.test(askText), askText.slice(0, 700));

    // 5. 同一标签第二次调用：验证 --session-id 续聊
    const ask2 = await request('tools/call', {
      name: 'dsh_ask',
      arguments: { task: '再回一句：这也是一句话。不要改文件。', session: 'verify', permission: 'read-only', timeout_ms: 300000 },
    }, 420000);
    const ask2Text = textOf(ask2);
    record('tools/call dsh_ask 续聊', !!ask2.result && !ask2.result.isError, ask2Text.slice(0, 500));
  }

  // 6. 会话表
  const sessions = await request('tools/call', { name: 'dsh_sessions', arguments: {} }, 30000);
  const sessText = textOf(sessions);
  record('tools/call dsh_sessions', OFFLINE ? sessText.length > 0 : sessText.includes('verify'), sessText.slice(0, 400));

  const failed = results.filter((r) => !r.pass);
  console.log('\nSUMMARY: ' + (results.length - failed.length) + '/' + results.length + ' passed');
  if (stderrChunks.length) console.log('bridge stderr: ' + stderrChunks.join('').slice(0, 500));
  child.stdin.end();
  setTimeout(() => process.exit(failed.length ? 1 : 0), 300);
} catch (err) {
  console.log('FATAL: ' + err.message);
  child.kill();
  process.exit(2);
}

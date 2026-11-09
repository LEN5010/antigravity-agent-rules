#!/usr/bin/env node
/**
 * dsh-crew MCP server (stdio) v0.1.0
 * 让反重力（Google Antigravity）等 MCP 客户端调用 DSH（DeepSeek Harness）智能体。
 *
 * 后端：官方 dsh headless runner（@deepseek-ai/dsh-headless）
 *   <DeepSeek Harness.exe> --expose-internals <dsh-desktop-host/lib/cli.js> --profile headless --json -
 *   - 任务经 stdin 传入（避免参数里的引号/换行问题）
 *   - --json 输出 NDJSON 事件流，取最后的 final 事件作为回答
 *   - --session-id 延续同一段对话
 *   - --patch crew-credentials.patch.yml 让 headless 复用桌面端已保存的 API 凭据
 *
 * 零依赖：只用 node 内建模块。
 * 协议：MCP（JSON-RPC 2.0，按行分隔，stdio）。
 */
import { spawn } from 'node:child_process';
process.noDeprecation = true;
import { existsSync, readdirSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_NAME = 'dsh-crew';
const SERVER_VERSION = '0.1.0';

const HOME = os.homedir();
const toSlash = (p) => p.replace(/\\/g, '/');

/**
 * 自动探测 DSH 桌面端安装根目录下的 headless 启动器。
 * 目录名随安装方式而异（Windows 默认 %LOCALAPPDATA%\Programs\<产品名>，
 * macOS 为 /Applications/<产品名>.app/Contents），所以扫描一级子目录而非写死产品名。
 * 探测不到时请显式设置 DSH_CREW_DSH_CMD。
 */
function detectDshCmd() {
  const roots = [];
  if (process.platform === 'win32') {
    if (process.env.LOCALAPPDATA) roots.push(path.join(process.env.LOCALAPPDATA, 'Programs'));
    roots.push('C:/Program Files');
  } else if (process.platform === 'darwin') {
    roots.push('/Applications');
  } else {
    roots.push('/opt');
  }
  for (const root of roots) {
    let entries = [];
    try { entries = readdirSync(root, { withFileTypes: true }); } catch (e) { continue; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const candidates = [
        path.join(root, e.name, 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd'),
        path.join(root, e.name, 'Contents', 'Resources', 'runtime', 'cli', 'bin', 'dsh'),
        path.join(root, e.name, 'resources', 'runtime', 'cli', 'bin', 'dsh'),
      ];
      for (const c of candidates) if (existsSync(c)) return c;
    }
  }
  return null;
}

const DSH_CMD = process.env.DSH_CREW_DSH_CMD || detectDshCmd() || '';
// 从启动器位置反推 app.asar：<根>/resources/runtime/cli/bin/dsh.cmd -> <根>/resources/app.asar
const DSH_ASAR = process.env.DSH_CREW_DSH_ASAR
  || (DSH_CMD ? path.join(path.dirname(DSH_CMD), '..', '..', '..', 'app.asar') : '');
const BUNDLED_PATCH = path.join(HERE, 'crew-credentials.patch.yml');
// headless 需要复用桌面端已保存的凭据；补丁放无空格路径，避免 cmd 引号问题
const CRED_PATCH = process.env.DSH_CREW_CRED_PATCH
  || path.join(HOME, '.dsh', 'dsh-crew', 'crew-credentials.patch.yml');
const qArg = (s) => (/\s/.test(s) ? '"' + s + '"' : s);

async function ensurePatch() {
  try {
    // 补丁里用 <YOUR_HOME> 占位，落盘前替换成本机家目录，避免把绝对路径写进仓库
    const want = (await fs.readFile(BUNDLED_PATCH, 'utf8')).replaceAll('<YOUR_HOME>', toSlash(HOME));
    let have = null;
    try { have = await fs.readFile(CRED_PATCH, 'utf8'); } catch (e) { have = null; }
    if (have !== want) {
      await fs.mkdir(path.dirname(CRED_PATCH), { recursive: true });
      await fs.writeFile(CRED_PATCH, want, 'utf8');
    }
    return true;
  } catch (e) {
    return false;
  }
}
const DEFAULT_CWD = process.env.DSH_CREW_WORKSPACE || process.cwd();
const STATE_DIR = process.env.DSH_CREW_STATE_DIR || path.join(HERE, 'state');
const STATE_FILE = path.join(STATE_DIR, 'crew-state.json');
const DEFAULT_TIMEOUT_MS = Number(process.env.DSH_CREW_TIMEOUT_MS || 900000);
const DEFAULT_SESSION = 'default';
const PERMISSIONS = new Set(['read-only', 'workspace-write', 'danger-full-access']);

// ---------- 状态 ----------
async function loadState() {
  try {
    const parsed = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || !parsed.sessions) return { sessions: {} };
    return parsed;
  } catch {
    return { sessions: {} };
  }
}

async function saveState(state) {
  await fs.mkdir(STATE_DIR, { recursive: true });
  const tmp = STATE_FILE + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
  await fs.rename(tmp, STATE_FILE);
}

// ---------- headless 运行器 ----------
let chain = Promise.resolve();
function serialize(fn) {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
}

function runHeadless(opts) {
  const { task, sessionId, cwd, permission, approvalPolicy, timeoutMs } = opts;
  return new Promise((resolve) => {
    if (!DSH_CMD) {
      resolve({
        ok: false, exitCode: null, killedByTimeout: false, sessionId: sessionId || null,
        answer: '', usage: null, stderr: '',
        error: 'DSH_CMD_NOT_CONFIGURED: 未找到 DSH 启动器。请设置 DSH_CREW_DSH_CMD 指向 '
          + '<DSH安装目录>/resources/runtime/cli/bin/dsh.cmd，或用 dsh_status 查看探测结果。',
      });
      return;
    }
    // 启动器级选项（--profile/--patch）必须排在 app 参数之前，否则 headless 报 unknown option
    const args = [
      '--profile', 'headless',
      '--patch', qArg(CRED_PATCH),
      '--json', '-',
      '--permission-mode', permission,
      '--approval-policy', approvalPolicy,
    ];
    if (sessionId) args.push('--session-id', sessionId);

    const child = spawn(DSH_CMD, args, {
      cwd,
      env: Object.assign({}, process.env),
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let outBuf = '';
    let stderr = '';
    let killedByTimeout = false;
    let resolvedSessionId = sessionId || null;
    let final = null;
    let usage = null;

    const timer = setTimeout(() => {
      killedByTimeout = true;
      try { child.kill('SIGKILL'); } catch (e) { /* ignore */ }
    }, timeoutMs);

    const consume = (line) => {
      const t = line.trim();
      if (!t.startsWith('{')) return;
      let evt;
      try { evt = JSON.parse(t); } catch (e) { return; }
      if (evt.type === 'session' && evt.sessionId) resolvedSessionId = evt.sessionId;
      else if (evt.type === 'final') {
        final = evt;
        if (evt.sessionId) resolvedSessionId = evt.sessionId;
      } else if (evt.type === 'status' && evt.usage) usage = evt.usage;
    };

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      outBuf += chunk;
      const lines = outBuf.split(/\r?\n/);
      outBuf = lines.pop() || '';
      lines.forEach(consume);
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (c) => { stderr += c; });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        ok: false, exitCode: null, killedByTimeout: false, sessionId: resolvedSessionId,
        answer: '', error: 'SPAWN_FAILED: ' + err.message, usage, stderr,
      });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (!final && outBuf.trim()) consume(outBuf);
      const reason = final && final.reason ? final.reason : null;
      const errObj = reason && reason.kind === 'error' ? reason.error : null;
      resolve({
        ok: code === 0 && !!final && !errObj && !killedByTimeout,
        exitCode: code,
        killedByTimeout,
        sessionId: resolvedSessionId,
        answer: final && typeof final.text === 'string' ? final.text : '',
        error: killedByTimeout
          ? 'TIMEOUT: 超过 ' + timeoutMs + ' ms 未完成，已终止本轮'
          : errObj ? ((errObj.code ? errObj.code + ': ' : '') + errObj.message)
          : (code === 0 ? null : (stderr.trim().split(/\r?\n/).pop() || ('exit ' + code))),
        usage,
        stderr: stderr.slice(-4000),
        reasonKind: reason ? reason.kind : null,
      });
    });

    child.stdin.on('error', () => {});
    child.stdin.end(task);
  });
}

const ok = (text) => ({ content: [{ type: 'text', text }] });
const fail = (text) => ({ content: [{ type: 'text', text }], isError: true });

// ---------- 工具实现 ----------
async function toolAsk(args) {
  const task = typeof args.task === 'string' ? args.task : '';
  if (!task.trim()) return fail('task 不能为空');
  const label = typeof args.session === 'string' && args.session.trim() ? args.session.trim() : DEFAULT_SESSION;
  const cwd = typeof args.cwd === 'string' && args.cwd.trim() ? args.cwd.trim() : DEFAULT_CWD;
  const permission = PERMISSIONS.has(args.permission) ? args.permission : 'workspace-write';
  const approvalPolicy = args.approval_policy === 'ask' ? 'ask' : 'never';
  const timeoutMs = Number.isFinite(args.timeout_ms)
    ? Math.min(Math.max(Number(args.timeout_ms), 10000), 3600000)
    : DEFAULT_TIMEOUT_MS;

  const state = await loadState();
  let labelKey = label;
  let sessionId = null;

  const byId = Object.keys(state.sessions).find((k) => state.sessions[k].sessionId === label);
  if (byId) {
    labelKey = byId;
    sessionId = label;
  } else if (/^session-[0-9a-z-]{8,}$/i.test(label)) {
    labelKey = 'session:' + label.slice(0, 20);
    sessionId = label;
  } else if (state.sessions[label]) {
    sessionId = state.sessions[label].sessionId;
  }

  await ensurePatch();
  const result = await serialize(() => runHeadless({ task, sessionId, cwd, permission, approvalPolicy, timeoutMs }));

  if (result.sessionId) {
    const prev = state.sessions[labelKey] || {};
    state.sessions[labelKey] = {
      sessionId: result.sessionId,
      cwd,
      permission,
      createdAt: prev.createdAt || new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
      runs: (prev.runs || 0) + 1,
      lastOk: result.ok,
    };
    await saveState(state);
  }

  const header = [
    'crew_session: ' + labelKey,
    'session_id: ' + (result.sessionId || '(unknown)'),
    'cwd: ' + cwd,
    'permission: ' + permission,
    'exit_code: ' + result.exitCode + (result.killedByTimeout ? ' (timeout)' : ''),
  ].join('\n');
  const usageLine = result.usage
    ? '\ntokens: in ' + (result.usage.inputTokens) + ' / out ' + (result.usage.outputTokens) + ' / total ' + (result.usage.totalTokens)
    : '';
  const body = result.ok
    ? '\n\n== DSH answer ==\n' + (result.answer || '(空回答)') + usageLine
    : '\n\n== DSH error ==\n' + (result.error || 'unknown') + (result.stderr ? '\n\nstderr(tail):\n' + result.stderr : '');
  const out = header + body;
  return result.ok ? ok(out) : { content: [{ type: 'text', text: out }], isError: true };
}

async function toolSessions() {
  const state = await loadState();
  const rows = Object.keys(state.sessions).map((label) => {
    const s = state.sessions[label];
    return {
      label, sessionId: s.sessionId, cwd: s.cwd, permission: s.permission,
      createdAt: s.createdAt, lastUsedAt: s.lastUsedAt, runs: s.runs, lastOk: s.lastOk,
    };
  });
  if (rows.length === 0) return ok('还没有任何 dsh-crew 会话。首次调用 dsh_ask 会自动创建（默认标签 default）。');
  return ok(JSON.stringify({ state_file: STATE_FILE, sessions: rows }, null, 2));
}

async function toolStatus() {
  const checks = {
    dsh_cmd_configured: { value: DSH_CMD || '(未探测到，请设 DSH_CREW_DSH_CMD)' },
    dsh_launcher: { path: DSH_CMD || '(empty)', exists: !!DSH_CMD && existsSync(DSH_CMD) },
    dsh_asar: { path: DSH_ASAR || '(empty)', exists: !!DSH_ASAR && existsSync(DSH_ASAR) },
    credentials_patch_bundled: { path: BUNDLED_PATCH, exists: existsSync(BUNDLED_PATCH) },
    credentials_patch_active: { path: CRED_PATCH, exists: existsSync(CRED_PATCH) },
    workspace: { path: DEFAULT_CWD, exists: existsSync(DEFAULT_CWD) },
    state_file: STATE_FILE,
    node: process.version,
    platform: process.platform,
  };
  const names = Object.keys(checks);
  const ready = names.every((n) => {
    const v = checks[n];
    return typeof v !== 'object' || v.exists === undefined || v.exists;
  });
  return ok(JSON.stringify({ server: SERVER_NAME, version: SERVER_VERSION, ready, backend: 'dsh headless', checks }, null, 2));
}

async function toolForget(args) {
  const label = typeof args.session === 'string' ? args.session.trim() : '';
  if (!label) return fail('session（标签）不能为空');
  const state = await loadState();
  if (!state.sessions[label]) return fail('没有叫 ' + label + ' 的 crew 会话');
  delete state.sessions[label];
  await saveState(state);
  return ok('已从 dsh-crew 状态里移除标签 ' + label + '（DSH 会话数据本身不动）。');
}

const TOOLS = [
  {
    name: 'dsh_ask',
    description:
      '把任务交给 DSH（DeepSeek Harness）智能体执行并拿回最终回答。DSH 与工作区共享同一套规则、技能与工具，可直接读写工作区文件。'
      + '用 session 标签续聊：同一标签 = 同一段 DSH 对话；首次调用自动创建（默认 default）。'
      + '适合：让 DSH 跑检查、改文件、查资料、写文档，再把结论回传。返回文本含 session_id 与 token 用量。',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: '交给 DSH 的完整任务描述（自然语言即可，越具体越好）。' },
        session: { type: 'string', description: '会话标签，默认 default；同一标签续聊同一段对话。也可直接传 session-<uuid>。' },
        cwd: { type: 'string', description: 'DSH 的工作目录，默认取本桥进程的当前目录（可用 DSH_CREW_WORKSPACE 覆盖）。' },
        permission: { type: 'string', enum: ['read-only', 'workspace-write', 'danger-full-access'], description: '权限档，默认 workspace-write（仅工作区可写）。' },
        approval_policy: { type: 'string', enum: ['never', 'ask'], description: '默认 never：需要人工审批的动作直接拒绝，避免无人值守时卡住。' },
        timeout_ms: { type: 'number', description: '单轮超时，默认 900000（15 分钟），范围 10s 至 60min。' },
      },
      required: ['task'],
    },
  },
  {
    name: 'dsh_sessions',
    description: '列出 dsh-crew 已保存的 DSH 会话（标签、session_id、工作目录、权限、使用次数、最近一次是否成功）。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'dsh_status',
    description: '自检 dsh-crew 后端是否可用：DSH 启动器、headless CLI、凭据补丁、工作目录与状态文件位置。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'dsh_forget',
    description: '从 dsh-crew 状态里移除某个会话标签（只忘记映射，不删除 DSH 会话数据）。',
    inputSchema: {
      type: 'object',
      properties: { session: { type: 'string', description: '要移除的会话标签。' } },
      required: ['session'],
    },
  },
];

// ---------- MCP 协议 ----------
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

async function handle(msg) {
  const id = msg.id;
  const method = msg.method;
  const params = msg.params;
  const isRequest = id !== undefined && id !== null;
  if (!isRequest) return; // notification，不回包

  switch (method) {
    case 'initialize': {
      const requested = params && params.protocolVersion;
      const version = PROTOCOL_VERSIONS.indexOf(requested) >= 0 ? requested : PROTOCOL_VERSIONS[0];
      send({ jsonrpc: '2.0', id, result: {
        protocolVersion: version,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        instructions: 'dsh-crew：调用本机 DSH（DeepSeek Harness）智能体。先用 dsh_status 自检，再用 dsh_ask 派任务；同一 session 标签续聊。',
      } });
      return;
    }
    case 'ping':
      send({ jsonrpc: '2.0', id, result: {} });
      return;
    case 'tools/list':
      send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
      return;
    case 'resources/list':
      send({ jsonrpc: '2.0', id, result: { resources: [] } });
      return;
    case 'prompts/list':
      send({ jsonrpc: '2.0', id, result: { prompts: [] } });
      return;
    case 'tools/call': {
      const name = params && params.name;
      const args = (params && params.arguments) || {};
      let out;
      try {
        if (name === 'dsh_ask') out = await toolAsk(args);
        else if (name === 'dsh_sessions') out = await toolSessions();
        else if (name === 'dsh_status') out = await toolStatus();
        else if (name === 'dsh_forget') out = await toolForget(args);
        else {
          send({ jsonrpc: '2.0', id, error: { code: -32602, message: 'unknown tool: ' + name } });
          return;
        }
      } catch (err) {
        out = { content: [{ type: 'text', text: 'dsh-crew internal error: ' + (err && err.message ? err.message : String(err)) }], isError: true };
      }
      send({ jsonrpc: '2.0', id, result: out });
      return;
    }
    default:
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found: ' + method } });
  }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  const lines = buffer.split(/\r?\n/);
  buffer = lines.pop() || '';
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    let msg;
    try { msg = JSON.parse(t); } catch (e) {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      continue;
    }
    Promise.resolve(handle(msg)).catch((err) => {
      if (msg && msg.id !== undefined && msg.id !== null) {
        send({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: String(err && err.message ? err.message : err) } });
      }
    });
  }
});
process.stdin.on('end', () => setTimeout(() => process.exit(0), 200));
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

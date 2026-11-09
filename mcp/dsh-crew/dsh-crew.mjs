#!/usr/bin/env node
/**
 * dsh-crew MCP server (stdio) v0.1.1
 * 让反重力（Google Antigravity）等 MCP 客户端调用 DSH（DeepSeek Harness）智能体。
 *
 * 后端：官方 dsh headless runner（@deepseek-ai/dsh-headless）
 *   <DeepSeek Harness.exe> --expose-internals <dsh-desktop-host/lib/cli.js> --profile headless --json -
 *   - 任务经 stdin 传入（避免参数里的引号/换行问题）
 *   - --json 输出 NDJSON 事件流，取最后的 final 事件作为回答
 *   - --session-id 延续同一段对话
 *   - --patch crew-credentials.patch.yml 让 headless 复用桌面端已保存的 API 凭据
 *   - 本机装有 dsh-commandcode 插件时，再叠加 crew-commandcode.patch.yml 切换默认模型
 *
 * 需要支持 --json / --session-id 的 headless（实测 dsh 0.2.2-rc.1 可用，0.1.5-rc.2 不支持）。
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
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_NAME = 'dsh-crew';
const SERVER_VERSION = '0.1.1';

const HOME = os.homedir();
const IS_WIN = process.platform === 'win32';

/**
 * 在 PATH 和常见全局安装目录里找 npm 全局安装的 dsh。
 * macOS 上从 Dock 启动的 GUI 客户端 PATH 往往不含 Homebrew 目录，所以额外补上两个常见位置。
 */
function findDshOnPath() {
  const names = IS_WIN ? ['dsh.cmd'] : ['dsh'];
  const dirs = (process.env.PATH || process.env.Path || '').split(path.delimiter).filter(Boolean);
  if (!IS_WIN) dirs.push('/opt/homebrew/bin', '/usr/local/bin');
  for (const d of dirs) {
    for (const n of names) {
      const p = path.join(d, n);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

/**
 * 自动探测 DSH 桌面端安装根目录下的 headless 启动器。
 * 目录名随安装方式而异（Windows 默认 %LOCALAPPDATA%\Programs\<产品名>，
 * macOS 为 /Applications/<产品名>.app/Contents），所以扫描一级子目录而非写死产品名。
 * 桌面端找不到时退回 npm 全局安装的 dsh；仍探测不到时请显式设置 DSH_CREW_DSH_CMD。
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
  return findDshOnPath();
}

const DSH_CMD = process.env.DSH_CREW_DSH_CMD || detectDshCmd() || '';
// 从启动器位置反推 app.asar：<根>/resources/runtime/cli/bin/dsh.cmd -> <根>/resources/app.asar
// npm 全局安装的 dsh 没有 asar，所以它只作参考信息，不计入 ready
const DSH_ASAR = process.env.DSH_CREW_DSH_ASAR
  || (DSH_CMD ? path.join(path.dirname(DSH_CMD), '..', '..', '..', 'app.asar') : '');
const BUNDLED_PATCH = path.join(HERE, 'crew-credentials.patch.yml');
const BUNDLED_MODEL_PATCH = path.join(HERE, 'crew-commandcode.patch.yml');
// headless 需要复用桌面端已保存的凭据；补丁放无空格路径，避免 cmd 引号问题
const CRED_PATCH = process.env.DSH_CREW_CRED_PATCH
  || path.join(HOME, '.dsh', 'dsh-crew', 'crew-credentials.patch.yml');
const MODEL_PATCH = path.join(path.dirname(CRED_PATCH), 'crew-commandcode.patch.yml');
// 可选的 Command Code provider 插件；文件存在时才叠加模型补丁，否则沿用 DSH 自身的默认模型
const COMMANDCODE_PLUGIN = process.env.DSH_CREW_COMMANDCODE_PLUGIN
  || path.join(HOME, '.dsh', 'profiles', 'desktop', 'node_modules', 'dsh-commandcode', 'index.js');
const qArg = (s) => (/\s/.test(s) ? '"' + s + '"' : s);

async function writeIfChanged(file, want) {
  let have = null;
  try { have = await fs.readFile(file, 'utf8'); } catch (e) { have = null; }
  if (have !== want) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, want, 'utf8');
  }
}

/**
 * 把仓库内的补丁模板落盘到 CRED_PATCH 所在目录，返回本轮要传给 --patch 的文件列表。
 * 插件路径用 pathToFileURL 生成，Windows 得到 file:///C:/...，macOS / Linux 得到 file:///Users/...。
 */
async function ensurePatches() {
  const patches = [];
  try {
    await writeIfChanged(CRED_PATCH, await fs.readFile(BUNDLED_PATCH, 'utf8'));
    patches.push(CRED_PATCH);
  } catch (e) {
    return { ok: false, patches, error: 'CRED_PATCH_WRITE_FAILED: ' + e.message };
  }
  if (existsSync(COMMANDCODE_PLUGIN)) {
    try {
      const want = (await fs.readFile(BUNDLED_MODEL_PATCH, 'utf8'))
        .replaceAll('<COMMANDCODE_PLUGIN_URL>', pathToFileURL(COMMANDCODE_PLUGIN).href);
      await writeIfChanged(MODEL_PATCH, want);
      patches.push(MODEL_PATCH);
    } catch (e) {
      return { ok: false, patches, error: 'MODEL_PATCH_WRITE_FAILED: ' + e.message };
    }
  }
  return { ok: true, patches, error: null };
}

/**
 * 子进程环境：把当前 node 所在目录追加到 PATH 末尾。
 * npm 安装的 dsh 以 `#!/usr/bin/env node` 启动，GUI 客户端的 PATH 里可能没有 node。
 */
function childEnv() {
  const env = Object.assign({}, process.env);
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  const parts = (env[key] || '').split(path.delimiter).filter(Boolean);
  const nodeDir = path.dirname(process.execPath);
  if (!parts.includes(nodeDir)) parts.push(nodeDir);
  env[key] = parts.join(path.delimiter);
  return env;
}

/**
 * 启动 DSH 启动器。Windows 的 dsh.cmd 必须经 cmd.exe 执行，所以只在 Windows 上开 shell，
 * 并给启动器路径本身加引号；其他平台直接 exec，路径里的空格（如 /Applications/<产品名>.app）不会被拆开。
 */
function spawnDsh(args, opts) {
  if (IS_WIN) {
    return spawn(qArg(DSH_CMD), args.map(qArg), Object.assign({ shell: true, windowsHide: true }, opts));
  }
  return spawn(DSH_CMD, args, Object.assign({ shell: false }, opts));
}

const HEADLESS_HINT = '当前 dsh 的 headless 不支持 dsh-crew 需要的参数（--json / --session-id 等），'
  + '请升级 dsh（实测 0.2.2-rc.1 可用，0.1.5-rc.2 不支持）。';

/** 用 `--profile headless --help` 检查 headless 是否支持桥需要的参数；不运行任务，不花 token。 */
function probeHeadless() {
  return new Promise((resolve) => {
    if (!DSH_CMD) { resolve({ ok: false, detail: 'DSH_CMD 未配置' }); return; }
    let out = '';
    let child;
    try {
      child = spawnDsh(['--profile', 'headless', '--help'], {
        cwd: existsSync(DEFAULT_CWD) ? DEFAULT_CWD : HOME, env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      resolve({ ok: false, detail: 'SPAWN_FAILED: ' + e.message });
      return;
    }
    // 比 verify.mjs 等待 dsh_status 的 60s 短，保证超时时仍能回包
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (e) { /* ignore */ } }, 30000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { out += c; });
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, detail: 'SPAWN_FAILED: ' + e.message }); });
    child.on('close', () => {
      clearTimeout(timer);
      const need = ['--json', '--session-id', '--permission-mode', '--approval-policy'];
      const missing = need.filter((f) => !out.includes(f));
      resolve(missing.length
        ? { ok: false, detail: HEADLESS_HINT + ' 缺少：' + missing.join(', ') }
        : { ok: true, detail: 'headless 支持 ' + need.join(' ') });
    });
  });
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
  const { task, sessionId, cwd, permission, approvalPolicy, timeoutMs, patches } = opts;
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
    const args = ['--profile', 'headless'];
    for (const p of patches) args.push('--patch', p);
    args.push(
      '--json', '-',
      '--permission-mode', permission,
      '--approval-policy', approvalPolicy,
    );
    if (sessionId) args.push('--session-id', sessionId);

    const child = spawnDsh(args, {
      cwd,
      env: childEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let outBuf = '';
    let stderr = '';
    let killedByTimeout = false;
    let resolvedSessionId = sessionId || null;
    let final = null;
    let usage = null;
    let streamError = null;

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
      // 用法错误或任务外失败时 headless 只发 error 事件、不发 final
      else if (evt.type === 'error' && typeof evt.message === 'string') streamError = evt.message;
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
      const oldHeadless = /unknown option '--(json|patch|session-id|permission-mode|approval-policy)'/.test(stderr);
      const fallback = streamError
        || (stderr.trim().split(/\r?\n/).pop() || ('exit ' + code));
      resolve({
        ok: code === 0 && !!final && !errObj && !killedByTimeout,
        exitCode: code,
        killedByTimeout,
        sessionId: resolvedSessionId,
        answer: final && typeof final.text === 'string' ? final.text : '',
        error: killedByTimeout
          ? 'TIMEOUT: 超过 ' + timeoutMs + ' ms 未完成，已终止本轮'
          : errObj ? ((errObj.code ? errObj.code + ': ' : '') + errObj.message)
          : code === 0 && final ? null
          : (oldHeadless ? HEADLESS_HINT + '\n' : '') + (code === 0 ? 'NO_FINAL_EVENT: ' : '') + fallback,
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

  const prepared = await ensurePatches();
  if (!prepared.ok) return fail(prepared.error);
  const patches = prepared.patches;
  const result = await serialize(() => runHeadless({ task, sessionId, cwd, permission, approvalPolicy, timeoutMs, patches }));

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
  // 先落盘补丁，避免首次调用 dsh_ask 之前 credentials_patch_active 永远是 false
  const prepared = await ensurePatches();
  const launcherExists = !!DSH_CMD && existsSync(DSH_CMD);
  const headless = launcherExists ? await probeHeadless() : { ok: false, detail: '启动器不存在，未检查' };
  const checks = {
    dsh_cmd_configured: { value: DSH_CMD || '(未探测到，请设 DSH_CREW_DSH_CMD)' },
    dsh_launcher: { path: DSH_CMD || '(empty)', exists: launcherExists },
    headless_cli: { exists: headless.ok, detail: headless.detail },
    // 仅桌面端安装才有 asar，npm 安装没有，不计入 ready
    dsh_asar: { path: DSH_ASAR || '(empty)', found: !!DSH_ASAR && existsSync(DSH_ASAR), optional: true },
    credentials_patch_bundled: { path: BUNDLED_PATCH, exists: existsSync(BUNDLED_PATCH) },
    credentials_patch_active: { path: CRED_PATCH, exists: existsSync(CRED_PATCH), error: prepared.error || undefined },
    commandcode_model_patch: {
      plugin: COMMANDCODE_PLUGIN,
      enabled: prepared.patches.includes(MODEL_PATCH),
      note: '插件存在时自动叠加；不存在时使用 DSH 自身的默认模型',
    },
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

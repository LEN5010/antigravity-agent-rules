'use strict';
// Efficiency diagnostics only. Never change command safety permissions.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function normalized(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  if (/^[a-z]+:\/\//i.test(value)) return null;
  if (!path.isAbsolute(value) || /^\\\\|^\/\//.test(value)) return null;
  const absolute = path.resolve(value);
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}
function versionOf(file) {
  try {
    const stat = fs.statSync(file);
    return stat.isFile() ? `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}` : null;
  } catch { return null; }
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}
function inspectCall(call) {
  const tool = typeof call?.name === 'string' ? call.name : 'unknown';
  const args = call?.args && typeof call.args === 'object' ? call.args : {};
  const result = { tool, argNames: Object.keys(args).sort(), kind: 'unparsed' };
  if (tool === 'view_file') {
    const file = normalized(args.AbsolutePath);
    const version = file && versionOf(file);
    const start = args.StartLine ?? 1;
    const end = args.EndLine;
    Object.assign(result, { kind: 'view', file, version });
    if (Number.isSafeInteger(start) && start >= 1 && Number.isSafeInteger(end) && end >= start) {
      result.range = [start, end];
      result.key = hash(JSON.stringify([file, version, start, end]));
    }
  } else if (tool === 'grep_search') {
    const file = normalized(args.SearchPath);
    Object.assign(result, {
      kind: 'search', file, version: file && versionOf(file),
      queryHash: hash(JSON.stringify(canonical(args)))
    });
    if (result.version) result.key = hash(JSON.stringify([file, result.version, result.queryHash]));
  } else if (tool === 'run_command') {
    result.kind = 'command';
    result.commandHash = hash(String(args.CommandLine ?? ''));
    result.cwd = normalized(args.Cwd);
    // Arbitrary shell commands cannot be safely converted into file reads.
  } else if (['write_to_file', 'replace_file_content', 'multi_replace_file_content'].includes(tool)) {
    result.kind = 'write';
    result.file = normalized(args.TargetFile);
  }
  return result;
}
function appendLog(root, record) {
  try {
    const file = path.join(root, 'read_loop_log.jsonl');
    if (fs.existsSync(file) && fs.statSync(file).size > 5 * 1024 * 1024) return;
    fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...record }) + '\n', 'utf8');
  } catch { /* Diagnostics must never block a tool. */ }
}
function scanEpoch(payload, state) {
  const file = payload.transcriptPath;
  const conv = payload.conversationId;
  // Only inspect the host-provided transcript for this conversation.
  if (typeof file !== 'string' || !/[\\/]\.system_generated[\\/]logs[\\/]transcript(?:_full)?\.jsonl$/i.test(file)) return null;
  if (!file.replace(/\\/g, '/').toLowerCase().includes(`/brain/${conv}/`.toLowerCase())) return null;
  try {
    const stat = fs.statSync(file);
    let cursor = state.cursor;
    if (!cursor || cursor.file !== file || cursor.offset > stat.size ||
        (cursor.offset === stat.size && cursor.mtime !== stat.mtimeMs)) {
      cursor = { file, offset: Math.max(0, stat.size - 262144), epoch: null, mtime: stat.mtimeMs };
    }
    if (stat.size - cursor.offset > 262144) {
      cursor.offset = Math.max(0, stat.size - 262144);
      cursor.epoch = null;
    }
    const length = stat.size - cursor.offset;
    if (length > 0) {
      const buffer = Buffer.alloc(length);
      const fd = fs.openSync(file, 'r');
      try { fs.readSync(fd, buffer, 0, length, cursor.offset); } finally { fs.closeSync(fd); }
      const lastNewline = buffer.lastIndexOf(10);
      if (lastNewline >= 0) {
        for (const line of buffer.subarray(0, lastNewline + 1).toString('utf8').split('\n')) {
          try {
            const row = JSON.parse(line);
            if (row.type === 'USER_INPUT' && Number.isSafeInteger(row.step_index)) {
              cursor.epoch = `user-${row.step_index}`;
            }
            if (/COMPACT/i.test(String(row.type ?? ''))) cursor.epoch = null;
          } catch { /* Partial lines and unknown transcript records are ignored. */ }
        }
        cursor.offset += lastNewline + 1;
      }
    }
    cursor.mtime = stat.mtimeMs;
    state.cursor = cursor;
    return cursor.epoch;
  } catch { return null; }
}
function handle(payload, event, options = {}) {
  const root = options.root || __dirname;
  const config = options.config || JSON.parse(fs.readFileSync(path.join(root, 'read_loop_settings.json'), 'utf8'));
  const allow = event === 'pre' ? { decision: 'allow' } : {};
  const conv = payload?.conversationId;
  if (typeof conv !== 'string' || !/^[a-z0-9_-]{1,100}$/i.test(conv)) {
    appendLog(root, { event, verdict: 'UNKNOWN_SCOPE', tool: payload?.toolCall?.name ?? 'unknown' });
    return allow;
  }
  const detail = inspectCall(payload.toolCall);
  const stateDir = path.join(root, 'state', 'read-loop-v1');
  fs.mkdirSync(stateDir, { recursive: true });
  const stateFile = path.join(stateDir, `${conv}.json`);
  const lockFile = stateFile + '.lock';
  let lock;
  try { lock = fs.openSync(lockFile, 'wx'); } catch {
    appendLog(root, { event, conversationId: conv, verdict: 'STATE_BUSY', tool: detail.tool });
    return allow;
  }
  try {
    let state = { schema: 1, epoch: null, entries: [] };
    if (fs.existsSync(stateFile)) state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (state.schema !== 1 || !Array.isArray(state.entries)) throw new Error('Invalid state schema');
    const epoch = scanEpoch(payload, state);
    if (state.epoch !== epoch) state.entries = [];
    state.epoch = epoch;
    const eligible = detail.kind === 'view' && detail.file && detail.version && detail.range;
    const exactPrevious = eligible ? state.entries.filter(entry => entry.key === detail.key) : [];
    const covered = eligible && state.entries.some(entry =>
      entry.kind === 'view' && entry.file === detail.file && entry.version === detail.version &&
      entry.range[0] <= detail.range[0] && entry.range[1] >= detail.range[1]);
    let verdict = 'OBSERVE';
    let result = allow;
    const armed = config.mode === 'enforce' && config.nativeCoverageVerified === true &&
      config.rangeOutputVerified === true && config.permissionPolicyVerified === true;
    if (event === 'pre' && covered) {
      verdict = 'DUPLICATE_CANDIDATE';
      if (armed && epoch && exactPrevious.length >= (config.repeatLimit ?? 3) - 1) {
        verdict = 'DENY_DUPLICATE';
        result = {
          decision: 'deny',
          reason: `READ LOOP: this unchanged file range already succeeded ${exactPrevious.length} times in the current task (last step ${exactPrevious.at(-1).stepIdx}). Reuse the earlier result. If content was truncated or context is missing, report the missing evidence instead of changing tools or copying the file.`
        };
      }
    }
    if (event === 'post') {
      if (payload.error) verdict = 'FAILED_NOT_CACHED';
      else if (detail.kind === 'write' && detail.file) {
        state.entries = state.entries.filter(entry => entry.file !== detail.file);
        verdict = 'WRITE_INVALIDATED';
      } else if (eligible) {
        state.entries.push({ ...detail, stepIdx: payload.stepIdx });
        state.entries = state.entries.slice(-96);
        verdict = covered ? 'SUCCESS_DUPLICATE_CANDIDATE' : 'SUCCESS_REQUEST_RECORDED';
      } else if (detail.kind === 'search') verdict = 'SEARCH_OBSERVED';
    }
    const temp = `${stateFile}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(state), 'utf8');
    fs.renameSync(temp, stateFile);
    appendLog(root, {
      event, conversationId: conv, stepIdx: payload.stepIdx, epoch,
      mode: config.mode, armed, verdict, ...detail, priorExactSuccesses: exactPrevious.length
    });
    return result;
  } finally {
    fs.closeSync(lock);
    fs.unlinkSync(lockFile);
  }
}
function main() {
  const started = process.hrtime.bigint();
  const event = process.argv[2] === 'post' ? 'post' : 'pre';
  let output = event === 'pre' ? { decision: 'allow' } : {};
  try { output = handle(JSON.parse(fs.readFileSync(0, 'utf8')), event); } catch (error) {
    appendLog(__dirname, { event, verdict: 'ERROR_FAILOPEN', error: error.code || error.name || 'UnknownError' });
  }
  appendLog(__dirname, { event, verdict: 'DURATION', durationMs: Number(process.hrtime.bigint() - started) / 1e6 });
  process.stdout.write(JSON.stringify(output));
}
module.exports = { handle, inspectCall, normalized };
if (require.main === module) main();

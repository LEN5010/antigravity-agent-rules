'use strict';
// ============================================================================
// Antigravity PreToolUse guard, Node version  (hook: hard-gate)
// ----------------------------------------------------------------------------
// Cross-platform port of pretool_guard.ps1. macOS / Linux installs use this
// file (install.sh); Windows installs keep pretool_guard.ps1 by default.
//
// CONTRACT (same as pretool_guard.ps1)
//   stdin  : hook payload JSON (camelCase), e.g.
//            {"toolCall":{"name":"run_command","args":{"CommandLine":"npm test"}},
//             "conversationId":"...", "stepIdx":19}
//   stdout : exactly ONE JSON object, nothing else.
//            {"decision":"ask"}               (default for non-flagged commands)
//            {"decision":"allow"}             (opt-in via AGY_HOOK_DEFAULT_DECISION=allow)
//            {"decision":"deny","reason":"..."}
//
// DESIGN NOTES
//   1. SAFE DEFAULT ("ask"). Non-flagged commands return {"decision":"ask"} by
//      default so the hook never auto-approves commands behind the user's back
//      under Ask-First policy. Set AGY_HOOK_DEFAULT_DECISION=allow to opt into
//      hook-level auto-approval.
//   2. FAIL-OPEN TO DEFAULT DECISION. Any internal error returns the default
//      decision ("ask" unless overridden).
//   3. PRIVACY & SECRET REDACTION IN AUDIT LOG. By default, hook_log.jsonl only
//      records blocked (DENY-DANGER) and error (ERROR-FAILOPEN) events (set
//      AGY_HOOK_LOG_ALL=1 to also log allowed/asked commands). All logged
//      commands are scrubbed for tokens, passwords, and API keys.
//   4. WINDOWS_RULES mirror pretool_guard.ps1 one-to-one. Keep them in sync.
//      UNIX_RULES are extra rules for macOS / Linux commands.
// ============================================================================

const fs = require('node:fs');
const path = require('node:path');

const SCRIPT_DIR = __dirname;
const LOG_FILE = path.join(SCRIPT_DIR, 'hook_log.jsonl');
const LOG_ROTATE_BYTES = 524288;
const EOL = process.platform === 'win32' ? '\r\n' : '\n';

const DEFAULT_MODE = /^(allow|ask)$/i.test(process.env.AGY_HOOK_DEFAULT_DECISION || '')
  ? process.env.AGY_HOOK_DEFAULT_DECISION.toLowerCase()
  : 'ask';
const DEFAULT_PASS = JSON.stringify({ decision: DEFAULT_MODE });
const LOG_ALL = /^(1|true|yes)$/i.test(process.env.AGY_HOOK_LOG_ALL || '');

const PROXY_RULE = 'user rule: proxy/network off-limits without explicit user approval';
const NETWORK_RULE = 'user rule: network off-limits without explicit user approval';

// Git prefix allowing global options (-C <dir>, -c <k=v>, --git-dir=..., --work-tree=..., etc.)
const GIT_PREFIX = '(^|[\\s;&|("\'`])git(\\.exe)?\\s+(?:-[Cc]\\s+\\S+\\s+|--(?:git-dir|work-tree|namespace|super-prefix|exec-path)(?:=\\S+|\\s+\\S+)\\s+|--(?:bare|no-pager|no-replace-objects|literal-pathspecs)\\s+)*';

// Mirrors pretool_guard.ps1 rules one-to-one.
const WINDOWS_RULES = [
  ['Remove-Item\\b[^;&|\\r\\n]*\\s-(r|recurse)\\b', 'recursive delete (Remove-Item -Recurse)'],
  ['(^|[^a-zA-Z0-9_-])(Remove-Item|ri|rm|del|erase|rd|rmdir)\\b[^;&|\\r\\n]*(\\s-(r|recurse)\\b)', 'recursive delete (PS alias/short-param)'],
  ['(^|[\\s;&|("\'`])rm\\s+(-[a-zA-Z]*[rR]|--recursive\\b|[^;&|\\r\\n]*\\s(-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)\\b)', 'rm -r / --recursive'],
  ['(^|[\\s;&|("\'`])find\\b[^;&|\\r\\n]*\\s(-delete\\b|-exec(dir)?\\s+(rm|rmdir)\\b)', 'find -delete / -exec rm'],
  ['(^|[\\s;&|("\'`])(python3?|node|nodejs|perl|ruby)(\\.exe)?\\b[^\\r\\n]*\\b(shutil\\.rmtree|os\\.(remove|unlink|rmdir|removedirs)|fs\\.(rmSync|rmdirSync|unlinkSync)|FileUtils\\.(rm_rf|remove_dir)|remove_tree)\\b', 'interpreter one-liner destructive delete'],
  ['(^|\\s)rd\\s+/s', 'rd /s'],
  ['(^|\\s)rmdir\\s+/s', 'rmdir /s'],
  ['(^|\\s)del\\s+/[a-zA-Z]*[fs]', 'del /f /s'],
  [GIT_PREFIX + 'reset\\b[^;&|\\r\\n]*\\s--hard\\b', 'git reset --hard'],
  [GIT_PREFIX + 'push\\b[^;&|\\r\\n]*(\\s--force(?![-a-zA-Z])|\\s-[a-zA-Z]*f\\b|\\s\\+[a-zA-Z0-9_./-]+)', 'git push --force / +refspec'],
  [GIT_PREFIX + 'clean\\b[^;&|\\r\\n]*\\s(-[a-zA-Z]*[fd]|--force\\b)', 'git clean -fd'],
  [GIT_PREFIX + 'checkout\\b[^;&|\\r\\n]*(\\s--\\s*(\\.|\\*)(\\s|$)|\\s(-f|--force)\\b)', 'git checkout -- . / --force'],
  [GIT_PREFIX + 'restore\\b(?![^;&|\\r\\n]*\\s(-S|--staged)\\b(?![^;&|\\r\\n]*\\s(-W|--worktree)\\b))[^;&|\\r\\n]*(\\s(\\.|\\*)(\\s|$)|\\s(-W|--worktree)\\b)', 'git restore working tree'],
  ['Format-Volume', 'Format-Volume'],
  ['(^|\\s)format\\s+[a-zA-Z]:', 'format drive'],
  ['Remove-Item.*HKLM:', 'registry delete (HKLM)'],
  ['(^|\\s)reg\\s+delete', 'reg delete'],
  ['Clear-Disk|Initialize-Disk', 'disk re-init'],
  ['(taskkill|tskill|pkill|killall|Stop-Process|wmic\\s+process).{0,120}(clash|verge|mihomo|sing-?box|singbox|v2ray|xray|nekobox|nekoray|netch|sstap|shadowsocks|trojan(-go)?|hysteria|naiveproxy|cfw|sysproxy|privoxy)', 'kill proxy client (' + PROXY_RULE + ')'],
  ['(clash|verge|mihomo|sing-?box|singbox|v2ray|xray|nekobox|nekoray|shadowsocks|hysteria).{0,120}(Stop-Process|taskkill|\\.Kill\\()', 'kill proxy client (' + PROXY_RULE + ')'],
  ['(sc(\\.exe)?\\s+(stop|delete|config)|net(\\.exe)?\\s+stop|Stop-Service).{0,120}(clash|sing-?box|v2ray|xray|wintun|tap-windows|tun2socks|shadowsocks|verge|nekobox)', 'stop/delete proxy service (' + PROXY_RULE + ')'],
  ['netsh.{0,80}(interface\\s+set\\s+interface|wlan\\s+disconnect)', 'disable NIC / disconnect WLAN (' + NETWORK_RULE + ')'],
  ['Disable-NetAdapter', 'disable network adapter (' + PROXY_RULE + ')'],
  ['ipconfig\\s+/release6?', 'release IP, drops connectivity (' + NETWORK_RULE + ')'],
  ['rasdial\\s+/d', 'hang up dialup/tunnel (' + PROXY_RULE + ')'],
  ['(^|\\s)route\\s+delete', 'delete route, may break TUN (' + PROXY_RULE + ')'],
  ['(reg(\\.exe)?\\s+add|Set-ItemProperty|New-ItemProperty|regedit).{0,160}Internet\\s+Settings', 'modify system proxy registry (' + PROXY_RULE + ')'],
  ['netsh\\s+winhttp\\s+set\\s+proxy', 'set WinHTTP proxy (' + PROXY_RULE + ')'],
];

// macOS / Linux proxy client names, in addition to the Windows list above.
const UNIX_PROXY_NAMES = '(clash|verge|mihomo|sing-?box|v2ray|xray|nekoray|shadowsocks|hysteria|surge|stash|flclash|hiddify|qv2ray|shadowrocket|tun2socks|privoxy)';

const UNIX_RULES = [
  // Disk / filesystem destruction
  ['(^|[\\s;&|(])diskutil\\s+(erase\\w*|zeroDisk|randomDisk|secureErase|partitionDisk|reformat|apfs\\s+(delete\\w*|erase\\w*))\\b', 'diskutil erase/partition'],
  ['(^|[\\s;&|(])dd\\b.*\\bof=/dev/', 'dd write to raw device'],
  ['(^|[\\s;&|(])(mkfs(\\.\\w+)?|newfs_\\w+)\\b', 'format filesystem'],
  ['(^|[\\s;&|(])tmutil\\s+delete', 'delete Time Machine backups'],
  ['(^|[\\s;&|(])csrutil\\s+disable', 'disable System Integrity Protection'],
  // Proxy clients: kill / stop / quit
  ['(^|[\\s;&|(])kill\\b.{0,120}' + UNIX_PROXY_NAMES, 'kill proxy client (' + PROXY_RULE + ')'],
  ['(pkill|killall).{0,120}' + UNIX_PROXY_NAMES, 'kill proxy client (' + PROXY_RULE + ')'],
  ['launchctl\\s+(stop|unload|bootout|remove|disable|kill)\\b.{0,160}' + UNIX_PROXY_NAMES, 'stop proxy launchd service (' + PROXY_RULE + ')'],
  ['systemctl\\s+(stop|disable|mask|kill)\\b.{0,160}' + UNIX_PROXY_NAMES, 'stop proxy systemd service (' + PROXY_RULE + ')'],
  ['osascript.{0,200}(quit.{0,120}' + UNIX_PROXY_NAMES + '|' + UNIX_PROXY_NAMES + '.{0,120}quit)', 'quit proxy app (' + PROXY_RULE + ')'],
  // System proxy / network settings. Read-only forms (-get*, -list*, scutil --proxy) stay allowed.
  ['networksetup\\s+-set\\w+', 'modify network/proxy settings via networksetup (' + PROXY_RULE + ')'],
  ['(^|[\\s;&|(])ifconfig\\s+\\S+\\s+down\\b', 'disable network interface (' + NETWORK_RULE + ')'],
  ['(^|[\\s;&|(])ip\\s+link\\s+set\\s+\\S+\\s+down\\b', 'disable network interface (' + NETWORK_RULE + ')'],
  ['(^|[\\s;&|(])ipconfig\\s+set\\s+\\S+\\s+(none|dhcp|bootp|manual|inform)\\b', 'reconfigure interface IP (' + NETWORK_RULE + ')'],
  ['(^|[\\s;&|(])route\\s+(-n\\s+)?(delete|flush|change)\\b', 'modify routes, may break TUN (' + PROXY_RULE + ')'],
  ['(^|[\\s;&|(])pfctl\\b.*\\s-(d|F)\\b', 'disable/flush pf firewall, may break TUN (' + PROXY_RULE + ')'],
  ['(^|[\\s;&|(])nmcli\\s+(networking\\s+off|radio\\s+wifi\\s+off|(dev(ice)?|con(nection)?)\\s+(down|disconnect))', 'disable network via nmcli (' + NETWORK_RULE + ')'],
];

const RULES = [...WINDOWS_RULES, ...UNIX_RULES].map(([rx, why]) => ({ rx: new RegExp(rx, 'i'), why }));

function stripSegmentQuotes(seg) {
  return seg
    .replace(/'[^']*'/g, "''")
    .replace(/"(?:\\.|[^"$`\\])*"/g, '""');
}

function maskDataQuotes(cmd) {
  if (!cmd) return '';
  let out = cmd;
  out = out.replace(/(^|[\s;&|(])(grep|egrep|fgrep|rg|ripgrep|ag|ack|Select-String|echo|printf|Write-Host|Write-Output)\b[^;&|\r\n]*/gi, stripSegmentQuotes);
  out = out.replace(/(^|[\s;&|(])git(\.exe)?\b[^;&|\r\n]*\b(commit|tag|notes|merge)\b[^;&|\r\n]*/gi, stripSegmentQuotes);
  return out;
}

function redactCmd(text) {
  if (!text) return '';
  let s = String(text);
  s = s.replace(/(https?:\/\/[^/\s:@]+:)[^/\s@]+(@)/gi, '$1<REDACTED>$2');
  s = s.replace(/(Authorization\s*:\s*(?:Bearer|Basic|Token)\s+)[^\s"'`]+/gi, '$1<REDACTED>');
  s = s.replace(/\b(sk-[a-zA-Z0-9_-]{10,}|gh[pousr]_[a-zA-Z0-9]{16,}|github_pat_[a-zA-Z0-9_]{16,}|AIza[0-9A-Za-z_-]{20,}|xox[baprs]-[a-zA-Z0-9-]{10,}|ak-[a-zA-Z0-9]{16,})\b/g, '<REDACTED_TOKEN>');
  s = s.replace(/(--?(?:token|password|passwd|secret|api-?key|access-?key|private-?key|auth-?token|client-?secret))(\s+|=)("[^"]*"|'[^']*'|\S+)/gi, '$1$2<REDACTED>');
  s = s.replace(/\b([A-Za-z0-9_]*(?:TOKEN|PASSWORD|PASSWD|SECRET|API_KEY|PRIVATE_KEY|ACCESS_KEY|CREDENTIAL)[A-Za-z0-9_]*)=("[^"]*"|'[^']*'|\S+)/gi, '$1=<REDACTED>');
  if (s.length > 500) s = s.slice(0, 500) + '...(truncated)';
  return s;
}

function check(cmd) {
  const masked = maskDataQuotes(cmd);
  for (const r of RULES) {
    if (r.rx.test(masked)) return r.why;
  }
  return null;
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function appendLog(record) {
  try {
    try {
      if (fs.statSync(LOG_FILE).size > LOG_ROTATE_BYTES) fs.renameSync(LOG_FILE, LOG_FILE + '.1');
    } catch { /* no log yet */ }
    fs.appendFileSync(LOG_FILE, JSON.stringify(record) + EOL, 'utf8');
  } catch { /* best effort, never fatal */ }
}

function main(raw) {
  let result = DEFAULT_PASS;
  try {
    if (!raw.trim()) throw new Error('empty stdin');
    const payload = JSON.parse(raw);
    const tool = String(payload?.toolCall?.name ?? '');
    const cmdRaw = payload?.toolCall?.args?.CommandLine;
    const cmd = typeof cmdRaw === 'string' ? cmdRaw : '';
    const why = check(cmd);
    if (why) {
      result = JSON.stringify({
        decision: 'deny',
        reason: 'HARD GATE: blocked - ' + why + ' (global rule 1/9). Report to the user instead of retrying a variant.',
      });
    }
    if (why || LOG_ALL) {
      appendLog({
        ts: stamp(),
        verdict: why ? 'DENY-DANGER' : DEFAULT_MODE.toUpperCase(),
        count: 0,
        tool,
        cmd: redactCmd(cmd),
      });
    }
  } catch (err) {
    result = DEFAULT_PASS;
    appendLog({ ts: stamp(), verdict: 'ERROR-FAILOPEN', error: String(err && err.message ? err.message : err).replace(/[\r\n]+/g, ' ') });
  }
  process.stdout.write(result);
}

if (require.main === module) {
  const chunks = [];
  process.stdin.on('data', (c) => chunks.push(c));
  process.stdin.on('end', () => main(Buffer.concat(chunks).toString('utf8')));
  process.stdin.on('error', () => main(''));
}

module.exports = { check, maskDataQuotes, redactCmd, WINDOWS_RULES, UNIX_RULES };

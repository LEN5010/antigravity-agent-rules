# ============================================================================
# Antigravity PreToolUse guard  (hook: hard-gate)
# ----------------------------------------------------------------------------
# CONTRACT
#   stdin  : hook payload JSON (camelCase), e.g.
#            {"toolCall":{"name":"run_command","args":{"CommandLine":"npm test"}},
#             "conversationId":"...", "stepIdx":19}
#   stdout : exactly ONE JSON object, nothing else.
#            {"decision":"ask"}               (default for non-flagged commands)
#            {"decision":"allow"}             (opt-in via AGY_HOOK_DEFAULT_DECISION=allow)
#            {"decision":"deny","reason":"..."}
#
# DESIGN NOTES
#   1. ASCII-ONLY SOURCE. Never add non-ASCII characters to this file.
#      Reason: Windows PowerShell 5.1 parses BOM-less scripts as ANSI, and
#      this path may contain non-ASCII directory names. Keeping the source pure
#      ASCII removes the whole class of encoding faults.
#   2. SAFE DEFAULT ("ask"). Non-flagged commands return {"decision":"ask"} by
#      default so the hook never auto-approves commands behind the user's back
#      under Ask-First policy. Users who want hook-level auto-approval can set
#      AGY_HOOK_DEFAULT_DECISION=allow.
#   3. FAIL-OPEN TO DEFAULT DECISION. Any internal error returns the default
#      decision ("ask" unless overridden) so a broken guard never wedges the
#      synchronous agent loop.
#   4. PRIVACY & SECRET REDACTION IN AUDIT LOG. By default, hook_log.jsonl only
#      records blocked (DENY-DANGER) and error (ERROR-FAILOPEN) events (set
#      AGY_HOOK_LOG_ALL=1 to log allowed/asked commands). All logged command
#      strings are scrubbed for tokens, passwords, and API keys before writing.
# ============================================================================

$ErrorActionPreference = 'Stop'

# Force English .NET exception messages so the audit log stays pure ASCII.
try {
    [System.Threading.Thread]::CurrentThread.CurrentUICulture = [System.Globalization.CultureInfo]::GetCultureInfo('en-US')
} catch { }

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$logFile   = Join-Path $scriptDir 'hook_log.jsonl'
$stateDir  = Join-Path $scriptDir 'state'

$defaultMode = 'ask'
if ($env:AGY_HOOK_DEFAULT_DECISION -match '^(allow|ask)$') {
    $defaultMode = $env:AGY_HOOK_DEFAULT_DECISION.ToLowerInvariant()
}
$DEFAULT_PASS = '{"decision":"' + $defaultMode + '"}'
$result       = $DEFAULT_PASS
$logAll       = ($env:AGY_HOOK_LOG_ALL -match '^(1|true|yes)$')

function Write-Utf8NoBom([string]$Path, [string]$Text, [bool]$Append) {
    $enc = New-Object System.Text.UTF8Encoding($false)
    if ($Append) {
        [System.IO.File]::AppendAllText($Path, $Text, $enc)
    } else {
        [System.IO.File]::WriteAllText($Path, $Text, $enc)
    }
}

function Redact-Command([string]$Text) {
    if ([string]::IsNullOrEmpty($Text)) { return '' }
    $s = $Text
    # Redact URL user:password@
    $s = [regex]::Replace($s, '(https?://[^/\s:@]+:)[^/\s@]+(@)', '$1<REDACTED>$2', 'IgnoreCase')
    # Redact Authorization: Bearer / Basic / Token headers
    $s = [regex]::Replace($s, '(Authorization\s*:\s*(?:Bearer|Basic|Token)\s+)[^\s"''`]+', '$1<REDACTED>', 'IgnoreCase')
    # Redact well-known token prefixes (OpenAI/Anthropic sk-, GitHub ghp_/github_pat_, Google AIza, Slack xox*)
    $s = [regex]::Replace($s, '\b(sk-[a-zA-Z0-9_-]{10,}|gh[pousr]_[a-zA-Z0-9]{16,}|github_pat_[a-zA-Z0-9_]{16,}|AIza[0-9A-Za-z_-]{20,}|xox[baprs]-[a-zA-Z0-9-]{10,}|ak-[a-zA-Z0-9]{16,})\b', '<REDACTED_TOKEN>')
    # Redact CLI flags carrying secrets (--token, --password, --api-key, --secret, etc.)
    $s = [regex]::Replace($s, '(--?(?:token|password|passwd|secret|api-?key|access-?key|private-?key|auth-?token|client-?secret))(\s+|=)("[^"]*"|''[^'']*''|\S+)', '$1$2<REDACTED>', 'IgnoreCase')
    # Redact ENV_VAR=secret assignments
    $s = [regex]::Replace($s, '\b([A-Za-z0-9_]*(?:TOKEN|PASSWORD|PASSWD|SECRET|API_KEY|PRIVATE_KEY|ACCESS_KEY|CREDENTIAL)[A-Za-z0-9_]*)=("[^"]*"|''[^'']*''|\S+)', '$1=<REDACTED>', 'IgnoreCase')
    if ($s.Length -gt 500) {
        $s = $s.Substring(0, 500) + '...(truncated)'
    }
    return $s
}

function Mask-DataQuotes([string]$CmdText) {
    if ([string]::IsNullOrWhiteSpace($CmdText)) { return '' }
    $eval = {
        param($m)
        $seg = $m.Value
        # Strip single-quoted literal strings (no shell expansion inside single quotes)
        $seg = [regex]::Replace($seg, '''[^'']*''', '''''')
        # Strip double-quoted literal strings that do not contain $( or ` command substitution
        $seg = [regex]::Replace($seg, '"(?:\\.|[^"$`\\])*"', '""')
        return $seg
    }
    $out = $CmdText
    # 1. Search / print commands where quoted strings are pattern/text data, not subshell code
    $out = [regex]::Replace($out, '(^|[\s;&|(])(grep|egrep|fgrep|rg|ripgrep|ag|ack|Select-String|echo|printf|Write-Host|Write-Output)\b[^;&|\r\n]*', $eval, 'IgnoreCase')
    # 2. Git commit / tag / notes / merge commands where -m "..." is a commit/tag message
    $out = [regex]::Replace($out, '(^|[\s;&|(])git(\.exe)?\b[^;&|\r\n]*\b(commit|tag|notes|merge)\b[^;&|\r\n]*', $eval, 'IgnoreCase')
    return $out
}

try {
    # --- stdin: decode STRICTLY as UTF-8 -----------------------------------
    $reader = New-Object System.IO.StreamReader(
        [Console]::OpenStandardInput(),
        (New-Object System.Text.UTF8Encoding($false)))
    $raw = $reader.ReadToEnd()
    $reader.Dispose()

    if ([string]::IsNullOrWhiteSpace($raw)) { throw 'empty stdin' }

    $payload = $raw | ConvertFrom-Json

    $tool = [string]$payload.toolCall.name
    $conv = [string]$payload.conversationId
    $cmd  = [string]$payload.toolCall.args.CommandLine

    if ([string]::IsNullOrWhiteSpace($conv)) { $conv = 'default' }
    if ([string]::IsNullOrWhiteSpace($cmd))  { $cmd  = '' }

    # Mask quoted data arguments in grep/rg/echo/git-commit so patterns like
    # grep -rn "rm -rf" scripts/ or git commit -m "fix rm -rf" are not false-flagged.
    $maskedCmd = Mask-DataQuotes $cmd

    # Git prefix allowing global options (-C <dir>, -c <k=v>, --git-dir=..., --work-tree=..., etc.)
    $gitPrefix = '(^|[\s;&|("''`])git(\.exe)?\s+(?:-[Cc]\s+\S+\s+|--(?:git-dir|work-tree|namespace|super-prefix|exec-path)(?:=\S+|\s+\S+)\s+|--(?:bare|no-pager|no-replace-objects|literal-pathspecs)\s+)*'

    # ------------------------------------------------------------------
    # 1) Dangerous-command hard block
    # ------------------------------------------------------------------
    $danger = $false
    $why    = ''

    $rules = @(
        @{ rx = 'Remove-Item\b[^;&|\r\n]*\s-(r|recurse)\b';          why = 'recursive delete (Remove-Item -Recurse)' },
        @{ rx = '(^|[^a-zA-Z0-9_-])(Remove-Item|ri|rm|del|erase|rd|rmdir)\b[^;&|\r\n]*(\s-(r|recurse)\b)'; why = 'recursive delete (PS alias/short-param)' },
        @{ rx = '(^|[\s;&|("''`])rm\s+(-[a-zA-Z]*[rR]|--recursive\b|[^;&|\r\n]*\s(-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)\b)'; why = 'rm -r / --recursive' },
        @{ rx = '(^|[\s;&|("''`])find\b[^;&|\r\n]*\s(-delete\b|-exec(dir)?\s+(rm|rmdir)\b)'; why = 'find -delete / -exec rm' },
        @{ rx = '(^|[\s;&|("''`])(python3?|node|nodejs|perl|ruby)(\.exe)?\b[^\r\n]*\b(shutil\.rmtree|os\.(remove|unlink|rmdir|removedirs)|fs\.(rmSync|rmdirSync|unlinkSync)|FileUtils\.(rm_rf|remove_dir)|remove_tree)\b'; why = 'interpreter one-liner destructive delete' },
        @{ rx = '(^|\s)rd\s+/s';                                     why = 'rd /s' },
        @{ rx = '(^|\s)rmdir\s+/s';                                  why = 'rmdir /s' },
        @{ rx = '(^|\s)del\s+/[a-zA-Z]*[fs]';                        why = 'del /f /s' },
        @{ rx = $gitPrefix + 'reset\b[^;&|\r\n]*\s--hard\b';         why = 'git reset --hard' },
        @{ rx = $gitPrefix + 'push\b[^;&|\r\n]*(\s--force(?![-a-zA-Z])|\s-[a-zA-Z]*f\b|\s\+[a-zA-Z0-9_./-]+)'; why = 'git push --force / +refspec' },
        @{ rx = $gitPrefix + 'clean\b[^;&|\r\n]*\s(-[a-zA-Z]*[fd]|--force\b)'; why = 'git clean -fd' },
        @{ rx = $gitPrefix + 'checkout\b[^;&|\r\n]*(\s--\s*(\.|\*)(\s|$)|\s(-f|--force)\b)'; why = 'git checkout -- . / --force' },
        @{ rx = $gitPrefix + 'restore\b(?![^;&|\r\n]*\s(-S|--staged)\b(?![^;&|\r\n]*\s(-W|--worktree)\b))[^;&|\r\n]*(\s(\.|\*)(\s|$)|\s(-W|--worktree)\b)'; why = 'git restore working tree' },
        @{ rx = 'Format-Volume';                                     why = 'Format-Volume' },
        @{ rx = '(^|\s)format\s+[a-zA-Z]:';                          why = 'format drive' },
        @{ rx = 'Remove-Item.*HKLM:';                                why = 'registry delete (HKLM)' },
        @{ rx = '(^|\s)reg\s+delete';                                why = 'reg delete' },
        @{ rx = 'Clear-Disk|Initialize-Disk';                        why = 'disk re-init' },
        # --- Proxy / network protection (user rule: proxy/network is OFF-LIMITS
        #     without explicit per-task user approval) --------------------------
        @{ rx = '(taskkill|tskill|pkill|killall|Stop-Process|wmic\s+process).{0,120}(clash|verge|mihomo|sing-?box|singbox|v2ray|xray|nekobox|nekoray|netch|sstap|shadowsocks|trojan(-go)?|hysteria|naiveproxy|cfw|sysproxy|privoxy)'; why = 'kill proxy client (user rule: proxy/network off-limits without explicit user approval)' },
        @{ rx = '(clash|verge|mihomo|sing-?box|singbox|v2ray|xray|nekobox|nekoray|shadowsocks|hysteria).{0,120}(Stop-Process|taskkill|\.Kill\()'; why = 'kill proxy client (user rule: proxy/network off-limits without explicit user approval)' },
        @{ rx = '(sc(\.exe)?\s+(stop|delete|config)|net(\.exe)?\s+stop|Stop-Service).{0,120}(clash|sing-?box|v2ray|xray|wintun|tap-windows|tun2socks|shadowsocks|verge|nekobox)'; why = 'stop/delete proxy service (user rule: proxy/network off-limits without explicit user approval)' },
        @{ rx = 'netsh.{0,80}(interface\s+set\s+interface|wlan\s+disconnect)'; why = 'disable NIC / disconnect WLAN (user rule: network off-limits without explicit user approval)' },
        @{ rx = 'Disable-NetAdapter';                                    why = 'disable network adapter (user rule: proxy/network off-limits without explicit user approval)' },
        @{ rx = 'ipconfig\s+/release6?';                                 why = 'release IP, drops connectivity (user rule: network off-limits without explicit user approval)' },
        @{ rx = 'rasdial\s+/d';                                          why = 'hang up dialup/tunnel (user rule: proxy/network off-limits without explicit user approval)' },
        @{ rx = '(^|\s)route\s+delete';                                  why = 'delete route, may break TUN (user rule: proxy/network off-limits without explicit user approval)' },
        @{ rx = '(reg(\.exe)?\s+add|Set-ItemProperty|New-ItemProperty|regedit).{0,160}Internet\s+Settings'; why = 'modify system proxy registry (user rule: proxy/network off-limits without explicit user approval)' },
        @{ rx = 'netsh\s+winhttp\s+set\s+proxy';                         why = 'set WinHTTP proxy (user rule: proxy/network off-limits without explicit user approval)' }
    )

    foreach ($r in $rules) {
        if ($maskedCmd -match $r.rx) { $danger = $true; $why = $r.why; break }
    }

    $count = 0

    # ------------------------------------------------------------------
    # 3) Verdict
    # ------------------------------------------------------------------
    if ($danger) {
        $result = '{"decision":"deny","reason":"HARD GATE: blocked - ' + $why + ' (global rule 1/9). Report to the user instead of retrying a variant."}'
    }

    # ------------------------------------------------------------------
    # 4) Audit log (best effort, never fatal; default logs DENY only + redacts secrets)
    # ------------------------------------------------------------------
    if ($danger -or $logAll) {
        try {
            if (Test-Path $logFile) {
                if ((Get-Item $logFile).Length -gt 524288) {
                    $rotFile = $logFile + '.1'
                    if (Test-Path $rotFile) { Remove-Item $rotFile -Force }
                    Move-Item $logFile $rotFile -Force
                }
            }
            $verdict = $defaultMode.ToUpperInvariant()
            if ($danger) { $verdict = 'DENY-DANGER' }

            $rec = [ordered]@{
                ts      = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
                verdict = $verdict
                count   = $count
                tool    = $tool
                cmd     = (Redact-Command $cmd)
            } | ConvertTo-Json -Compress

            Write-Utf8NoBom -Path $logFile -Text ($rec + "`r`n") -Append $true
        } catch { }
    }
}
catch {
    $result = $DEFAULT_PASS
    try {
        $msg = [string]$_.Exception.Message
        $msg = $msg -replace '[\r\n]+', ' '
        $msg = $msg -replace '"', "'"
        $rec = '{"ts":"' + (Get-Date).ToString('yyyy-MM-dd HH:mm:ss') + '","verdict":"ERROR-FAILOPEN","error":"' + $msg + '"}'
        Write-Utf8NoBom -Path $logFile -Text ($rec + "`r`n") -Append $true
    } catch { }
}

# --- stdout: emit UTF-8 so text survives regardless of the console code page
$writer = New-Object System.IO.StreamWriter(
    [Console]::OpenStandardOutput(),
    (New-Object System.Text.UTF8Encoding($false)))
$writer.Write($result)
$writer.Flush()
$writer.Dispose()

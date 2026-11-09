# ============================================================================
# Antigravity PreToolUse guard  (hook: hard-gate)
# ----------------------------------------------------------------------------
# CONTRACT
#   stdin  : hook payload JSON (camelCase), e.g.
#            {"toolCall":{"name":"run_command","args":{"CommandLine":"npm test"}},
#             "conversationId":"...", "stepIdx":19}
#   stdout : exactly ONE JSON object, nothing else.
#            {"decision":"allow"}
#            {"decision":"deny","reason":"..."}
#
# DESIGN NOTES
#   1. ASCII-ONLY SOURCE. Never add non-ASCII characters to this file.
#      Reason: Windows PowerShell 5.1 parses BOM-less scripts as ANSI, and
#      this path contains non-ASCII directory names. Keeping the source pure
#      ASCII removes the whole class of encoding faults.
#   2. FAIL-OPEN. Any internal error -> {"decision":"allow"}.
#      A broken guard must never wedge the agent loop (hooks are synchronous).
#   3. "allow" is emitted for every non-flagged command. That matches the
#      current Antigravity setting autoExecutionPolicy=EAGER (Turbo), where
#      run_command is auto-executed anyway. IF YOU EVER SWITCH TO AN
#      ASK-FIRST POLICY, this hook must be changed too, otherwise it will
#      keep silently auto-approving commands.
# ============================================================================

$ErrorActionPreference = 'Stop'

# Force English .NET exception messages so the audit log stays pure ASCII.
try {
    [System.Threading.Thread]::CurrentThread.CurrentUICulture = [System.Globalization.CultureInfo]::GetCultureInfo('en-US')
} catch { }

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$logFile   = Join-Path $scriptDir 'hook_log.jsonl'
$stateDir  = Join-Path $scriptDir 'state'

$ALLOW       = '{"decision":"allow"}'
$result      = $ALLOW
# Efficiency accounting is handled by read_loop_guard.cjs.

function Write-Utf8NoBom([string]$Path, [string]$Text, [bool]$Append) {
    $enc = New-Object System.Text.UTF8Encoding($false)
    if ($Append) {
        [System.IO.File]::AppendAllText($Path, $Text, $enc)
    } else {
        [System.IO.File]::WriteAllText($Path, $Text, $enc)
    }
}

try {
    # --- stdin: decode STRICTLY as UTF-8 -----------------------------------
    # Antigravity writes the hook payload as raw UTF-8 bytes. PowerShell 5.1
    # would otherwise decode [Console]::In using the OEM code page (GBK / 936
    # on zh-CN Windows). Non-ASCII bytes - e.g. the Chinese user name in
    # C:\Users\<chinese>\... - then get mangled mid-sequence, and the byte
    # that follows a backslash can be swallowed into a double-byte GBK char.
    # That turns a legal JSON escape into an illegal one and the whole parse
    # fails. Reading the raw standard-input stream with an explicit UTF-8
    # decoder bypasses the console code page entirely.
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

    # ------------------------------------------------------------------
    # 1) Dangerous-command hard block
    # ------------------------------------------------------------------
    $danger = $false
    $why    = ''

    $rules = @(
        @{ rx = 'Remove-Item.*-Recurse.*-Force';                    why = 'recursive force delete' },
        @{ rx = 'Remove-Item.*-Force.*-Recurse';                    why = 'recursive force delete' },
        @{ rx = '(^|[^a-zA-Z])(Remove-Item|ri|rm|del|erase|rd|rmdir)\b.*(\s-(r|recurse)\b).*(\s-(fo|force)\b)'; why = 'recursive force delete (PS alias/short-param)' },
        @{ rx = '(^|[^a-zA-Z])(Remove-Item|ri|rm|del|erase|rd|rmdir)\b.*(\s-(fo|force)\b).*(\s-(r|recurse)\b)'; why = 'recursive force delete (PS alias/short-param)' },
        @{ rx = '(^|[^a-zA-Z])rm\s+-[a-zA-Z]*r[a-zA-Z]*f';           why = 'rm -rf' },
        @{ rx = '(^|[^a-zA-Z])rm\s+-[a-zA-Z]*f[a-zA-Z]*r';           why = 'rm -fr' },
        @{ rx = '(^|[^a-zA-Z])rm\b.*(\s(-[a-zA-Z]*r[a-zA-Z]*|--recursive)\b).*(\s(-[a-zA-Z]*f[a-zA-Z]*|--force)\b)'; why = 'rm -r -f / --recursive --force' },
        @{ rx = '(^|[^a-zA-Z])rm\b.*(\s(-[a-zA-Z]*f[a-zA-Z]*|--force)\b).*(\s(-[a-zA-Z]*r[a-zA-Z]*|--recursive)\b)'; why = 'rm -f -r / --force --recursive' },
        @{ rx = '(^|\s)rd\s+/s';                                     why = 'rd /s' },
        @{ rx = '(^|\s)rmdir\s+/s';                                  why = 'rmdir /s' },
        @{ rx = '(^|\s)del\s+/[a-zA-Z]*[fs]';                        why = 'del /f /s' },
        @{ rx = 'git\s+reset\s+--hard';                              why = 'git reset --hard' },
        @{ rx = 'git\s+push.*(--force|[^a-zA-Z]-f([^a-zA-Z]|$))';    why = 'git push --force' },
        @{ rx = 'git\s+clean\s+-[a-zA-Z]*[fd]';                      why = 'git clean -fd' },
        @{ rx = 'Format-Volume';                                     why = 'Format-Volume' },
        @{ rx = '(^|\s)format\s+[a-zA-Z]:';                          why = 'format drive' },
        @{ rx = 'Remove-Item.*HKLM:';                                why = 'registry delete (HKLM)' },
        @{ rx = '(^|\s)reg\s+delete';                                why = 'reg delete' },
        @{ rx = 'Clear-Disk|Initialize-Disk';                        why = 'disk re-init' },
        # --- VPN / proxy protection (user directive 2026-09-26: the VPN is
        #     OFF-LIMITS without explicit per-task user approval) -----------
        @{ rx = '(taskkill|tskill|pkill|killall|Stop-Process|wmic\s+process).{0,120}(clash|verge|mihomo|sing-?box|singbox|v2ray|xray|nekobox|nekoray|netch|sstap|shadowsocks|trojan(-go)?|hysteria|naiveproxy|cfw|sysproxy|privoxy)'; why = 'kill VPN/proxy client (user rule: VPN off-limits without explicit user approval)' },
        @{ rx = '(clash|verge|mihomo|sing-?box|singbox|v2ray|xray|nekobox|nekoray|shadowsocks|hysteria).{0,120}(Stop-Process|taskkill|\.Kill\()'; why = 'kill VPN/proxy client (user rule: VPN off-limits without explicit user approval)' },
        @{ rx = '(sc(\.exe)?\s+(stop|delete|config)|net(\.exe)?\s+stop|Stop-Service).{0,120}(clash|sing-?box|v2ray|xray|wintun|tap-windows|tun2socks|shadowsocks|verge|nekobox)'; why = 'stop/delete proxy service (user rule: VPN off-limits without explicit user approval)' },
        @{ rx = 'netsh.{0,80}(interface\s+set\s+interface|wlan\s+disconnect)'; why = 'disable NIC / disconnect WLAN (user rule: network off-limits without explicit user approval)' },
        @{ rx = 'Disable-NetAdapter';                                    why = 'disable network adapter (user rule: VPN off-limits without explicit user approval)' },
        @{ rx = 'ipconfig\s+/release6?';                                 why = 'release IP, drops connectivity (user rule: network off-limits without explicit user approval)' },
        @{ rx = 'rasdial\s+/d';                                          why = 'hang up dialup/VPN (user rule: VPN off-limits without explicit user approval)' },
        @{ rx = '(^|\s)route\s+delete';                                  why = 'delete route, may break TUN (user rule: VPN off-limits without explicit user approval)' },
        @{ rx = '(reg(\.exe)?\s+add|Set-ItemProperty|New-ItemProperty|regedit).{0,160}Internet\s+Settings'; why = 'modify system proxy registry (user rule: VPN off-limits without explicit user approval)' },
        @{ rx = 'netsh\s+winhttp\s+set\s+proxy';                         why = 'set WinHTTP proxy (user rule: VPN off-limits without explicit user approval)' }
    )

    foreach ($r in $rules) {
        if ($cmd -match $r.rx) { $danger = $true; $why = $r.why; break }
    }

    # Efficiency diagnostics are separate from dangerous-command gating.
    # Legacy path regexes counted failed attempts and URL fragments.
    $count = 0

    # ------------------------------------------------------------------
    # 3) Verdict
    # ------------------------------------------------------------------
    if ($danger) {
        $result = '{"decision":"deny","reason":"HARD GATE: blocked - ' + $why + ' (global rule 1/9). Report to the user instead of retrying a variant."}'
    }

    # ------------------------------------------------------------------
    # 4) Audit log (best effort, never fatal)
    # ------------------------------------------------------------------
    try {
        if (Test-Path $logFile) {
            if ((Get-Item $logFile).Length -gt 524288) {
                $rotFile = $logFile + '.1'
                if (Test-Path $rotFile) { Remove-Item $rotFile -Force }
                Move-Item $logFile $rotFile -Force
            }
        }
        $verdict = 'ALLOW'
        if ($danger) { $verdict = 'DENY-DANGER' }

        $rec = [ordered]@{
            ts      = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
            verdict = $verdict
            count   = $count
            tool    = $tool
            cmd     = $cmd
        } | ConvertTo-Json -Compress

        Write-Utf8NoBom -Path $logFile -Text ($rec + "`r`n") -Append $true
    } catch { }
}
catch {
    $result = $ALLOW
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

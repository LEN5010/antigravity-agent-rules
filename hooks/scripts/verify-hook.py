"""
verify-hook.py - offline regression self-test for the Antigravity PreToolUse guard.

Why this exists
---------------
The guard script reads its payload from stdin. Antigravity sends that payload
as raw UTF-8 bytes, but Windows PowerShell 5.1 decodes stdin with the OEM code
page (GBK/936 on zh-CN). Any non-ASCII byte - for example the Chinese user name
in C:\\Users\\<cn>\\... - got mangled, and a byte following a backslash could be
absorbed into a double-byte GBK character. That turned a legal JSON escape into
an illegal one, the parse failed, and the guard silently fail-opened.

NOTE: This script feeds synthetic UTF-8 payloads to the guard script over stdin
to verify regex rules, quote-masking, secret redaction, and UTF-8 decoding. It
does NOT prove that the Antigravity host process has loaded hooks.json; see
README.md for the live host verification step.

Usage
-----
    python verify-hook.py                 # Windows: tests pretool_guard.ps1
    python3 verify-hook.py                # macOS / Linux: tests pretool_guard.cjs
    python verify-hook.py --guard node    # force the Node guard (any OS)
    python verify-hook.py --guard ps      # force the PowerShell guard

Exit code 0 = all assertions passed, 1 = at least one failure.
"""
import json
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CASES = os.path.join(HERE, "test-cases.txt")
LOG = os.path.join(HERE, "hook_log.jsonl")
STATE = os.path.join(HERE, "state")

PASS_DECISION = "ask"


def pick_guard():
    if "--guard" in sys.argv:
        idx = sys.argv.index("--guard")
        if idx + 1 < len(sys.argv) and sys.argv[idx + 1] in ("ps", "node"):
            return sys.argv[idx + 1]
        sys.exit("usage: verify-hook.py [--guard ps|node]")
    return "ps" if os.name == "nt" else "node"


GUARD = pick_guard()

if GUARD == "ps":
    SCRIPT = os.path.join(HERE, "pretool_guard.ps1")
    PS = os.path.join(
        os.environ.get("SystemRoot", r"C:\Windows"),
        "System32", "WindowsPowerShell", "v1.0", "powershell.exe",
    )
    GUARD_CMD = [PS, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", SCRIPT]
else:
    SCRIPT = os.path.join(HERE, "pretool_guard.cjs")
    NODE = os.environ.get("NODE") or shutil.which("node") or "node"
    GUARD_CMD = [NODE, SCRIPT]

CN = "\u6d4b\u8bd5\u7528\u6237"  # Chinese user-name characters for UTF-8 test


def call_guard(payload_obj):
    """Send a payload as UTF-8 bytes on stdin, return the parsed verdict."""
    raw = json.dumps(payload_obj, ensure_ascii=False).encode("utf-8")
    env = os.environ.copy()
    env.pop("AGY_HOOK_DEFAULT_DECISION", None)
    env.pop("AGY_HOOK_LOG_ALL", None)
    proc = subprocess.run(
        GUARD_CMD,
        input=raw, capture_output=True, timeout=90, env=env,
    )
    text = proc.stdout.decode("utf-8", errors="replace").strip()
    try:
        return json.loads(text).get("decision", "?"), text
    except Exception:
        return "<unparsable>", text or repr(proc.stderr[:200])


def payload(command, conversation="selftest", step=1, cwd=None):
    args = {"CommandLine": command}
    if cwd:
        args["Cwd"] = cwd
    return {
        "artifactDirectoryPath": "C:/Users/%s/.gemini/antigravity/brain/selftest" % CN,
        "conversationId": conversation,
        "modelName": "gemini-3.8-flash-high",
        "stepIdx": step,
        "toolCall": {"name": "run_command", "args": args},
        "workspacePaths": ["c:/Users/%s/Desktop/test/gemini" % CN],
    }


results = []


def check(label, command, expected, conversation="selftest", cwd=None):
    got, raw = call_guard(payload(command, conversation=conversation, cwd=cwd))
    ok = got == expected
    results.append((ok, label, expected, got, command))
    print("%-4s %-46s expected=%-6s got=%-6s" % ("PASS" if ok else "FAIL",
                                                 label, expected, got))
    return got


def main():
    for path in (LOG, os.path.join(STATE, "")):
        try:
            if os.path.isfile(path):
                os.remove(path)
        except OSError:
            pass
    if os.path.isdir(STATE):
        for f in os.listdir(STATE):
            try:
                os.remove(os.path.join(STATE, f))
            except OSError:
                pass

    print("=" * 78)
    print("SECTION 1  dangerous commands from test-cases.txt (ASCII framing)")
    print("=" * 78)
    with open(CASES, encoding="utf-8") as fh:
        lines = [ln.strip() for ln in fh if ln.strip()]
    pass_list = {"Get-ChildItem C:\\ | Select-Object Name", "node build.mjs", "npm test"}
    for i, cmd in enumerate(lines):
        expected = PASS_DECISION if cmd in pass_list else "deny"
        check("case %02d" % (i + 1), cmd, expected, conversation="s1-%d" % i)

    print()
    print("=" * 78)
    print("SECTION 2  the encoding regression (Chinese path in the payload)")
    print("=" * 78)
    check("benign + Chinese path", "echo hook-probe", PASS_DECISION,
          conversation="s2-a", cwd="c:\\Users\\%s\\Desktop\\test\\gemini" % CN)
    check("DANGEROUS + Chinese path", "Remove-Item C:\\Users\\%s\\temp\\x -Recurse -Force" % CN,
          "deny", conversation="s2-b", cwd="c:\\Users\\%s\\Desktop\\test\\gemini" % CN)

    print()
    print("=" * 78)
    print("SECTION 3  proxy / network protection")
    print("=" * 78)
    proxy_deny_cases = [
        ("kill proxy (taskkill mihomo)", "taskkill /F /IM mihomo.exe"),
        ("kill proxy (Stop-Process clash)", "Stop-Process -Name clash-verge -Force"),
        ("kill proxy (pipeline Stop-Process)", "Get-Process sing-box | Stop-Process -Force"),
        ("stop proxy service (sc stop)", "sc.exe stop clash-verge-service"),
        ("stop TUN service (Stop-Service)", "Stop-Service -Name tun2socks -Force"),
        ("disconnect WLAN (netsh)", "netsh wlan disconnect"),
        ("disable NIC (Disable-NetAdapter)", "Disable-NetAdapter -Name 'WLAN' -Confirm:$false"),
        ("release IP (ipconfig /release)", "ipconfig /release"),
        ("hang up dial-up/tunnel (rasdial /d)", "rasdial /d"),
        ("delete route (route delete)", "route delete 0.0.0.0"),
        ("modify proxy reg (reg add)", r'reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyEnable /t REG_DWORD /d 0 /f'),
        ("modify proxy reg (Set-ItemProperty)", r'Set-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings" -Name ProxyEnable -Value 0'),
        ("set WinHTTP proxy (netsh winhttp)", "netsh winhttp set proxy 127.0.0.1:7890"),
    ]
    for idx, (label, cmd) in enumerate(proxy_deny_cases):
        check(label, cmd, "deny", conversation="s3-deny-%d" % idx)

    proxy_pass_cases = [
        ("read-only proxy process check", "Get-Process clash,mihomo,sing-box -ErrorAction SilentlyContinue"),
        ("read-only proxy registry query", r'reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyEnable'),
        ("read-only HTTP HEAD probe", "curl.exe -I -s -m 5 https://example.com"),
    ]
    for idx, (label, cmd) in enumerate(proxy_pass_cases):
        check(label, cmd, PASS_DECISION, conversation="s3-pass-%d" % idx)

    print()
    print("=" * 78)
    print("SECTION 4  edge cases: git -C, refspec +, find -delete, quote masking")
    print("=" * 78)
    edge_deny_cases = [
        ("git -C repo reset --hard", "git -C repo reset --hard"),
        ("git checkout -- .", "git checkout -- ."),
        ("git -C repo checkout -- .", "git -C repo checkout -- ."),
        ("git restore .", "git restore ."),
        ("git -C repo restore .", "git -C repo restore ."),
        ("rm -r build (without -f)", "rm -r build"),
        ("find -delete", "find . -name '*.tmp' -delete"),
        ("git push origin +main", "git push origin +main"),
        ("bash -c wrapped rm -rf", 'bash -lc "rm -rf /tmp/x"'),
        ("python -c shutil.rmtree", 'python -c "import shutil; shutil.rmtree(\'build\')"'),
        ("node -e fs.rmSync", 'node -e "fs.rmSync(\'build\', {recursive:true})"'),
        ("grep followed by && rm -rf", 'grep -rn "rm -rf" scripts/ && rm -rf build --token sk-secret1234567890'),
        # Path-prefixed executables are the same commands.
        ("/bin/rm -rf (absolute path)", "/bin/rm -rf src"),
        ("\\rm -rf (alias bypass)", "\\rm -rf src"),
        ("/usr/bin/git reset --hard", "/usr/bin/git reset --hard"),
        ("quoted git.exe path reset --hard", '& "C:\\Program Files\\Git\\cmd\\git.exe" reset --hard'),
        # Printed text that is piped into a shell, or re-read through substitution, is code.
        ("echo ... | sh", "echo 'rm -rf src' | sh"),
        ("printf ... | sudo bash", "printf 'git reset --hard' | sudo bash"),
        ("eval of echoed text", "eval \"$(echo 'rm -rf src')\""),
        # Whole-tree / whole-directory discards and their neighbours.
        ("git checkout . (no --)", "git checkout ."),
        ("git checkout -- src/", "git checkout -- src/"),
        ("git restore src/", "git restore src/"),
        ("git restore -s HEAD~1 . (source, not staged)", "git restore -s HEAD~1 ."),
        ("git stash clear", "git stash clear"),
        ("git switch --discard-changes", "git switch --discard-changes main"),
        ("git rm -rf", "git rm -rf src"),
        ("find -exec /bin/rm", "find build -type d -exec /bin/rm -rf {} +"),
        ("bare rmtree import", 'python -c "from shutil import rmtree; rmtree(\'src\')"'),
        ("require(fs).rmSync recursive", "node -e \"require('fs').rmSync('src',{recursive:true})\""),
    ]
    for idx, (label, cmd) in enumerate(edge_deny_cases):
        check(label, cmd, "deny", conversation="s4-deny-%d" % idx)

    edge_pass_cases = [
        ("grep -rn 'rm -rf' scripts/", 'grep -rn "rm -rf" scripts/'),
        ("git commit -m with rm -rf", 'git commit -m "fix rm -rf and git reset --hard regex"'),
        ("git push --force-with-lease", "git push --force-with-lease origin main"),
        ("git restore --staged . (safe unstage)", "git restore --staged ."),
        ("git restore --staged src/", "git restore --staged src/"),
        ("git clean dry run", "git clean -n -d"),
        ("git clean --dry-run -fd", "git clean --dry-run -fd"),
        ("git rm -r --cached (untrack only)", "git rm -r --cached node_modules"),
        ("pnpm rm -r (dependency, not files)", "pnpm rm -r lodash"),
        ("docker rm (container)", "docker container rm -f web"),
        ("git checkout single file", "git checkout -- src/a.ts"),
        ("git push --force-if-includes", "git push --force-with-lease --force-if-includes origin main"),
        ("interpreter single-file delete", 'python -c "import os; os.remove(\'tmp.txt\')"'),
        ("sed script mentioning rm -rf", 'sed -i "s/rm -rf/trash/" clean.sh'),
        ("echo text to a file", "echo 'rm -rf src' > notes.txt"),
        ("echo text piped to tee", "echo 'git reset --hard' | tee -a notes.txt"),
        ("repeat benign build #1", "npm run build"),
        ("repeat read-only ls #1", "ls -la"),
    ]
    for idx, (label, cmd) in enumerate(edge_pass_cases):
        check(label, cmd, PASS_DECISION, conversation="s4-pass-%d" % idx)

    if GUARD == "node":
        print()
        print("=" * 78)
        print("SECTION 5  macOS / Linux rules (Node guard only)")
        print("=" * 78)
        unix_deny_cases = [
            ("rm -Rf (uppercase R)", "rm -Rf ~/Projects/tmp"),
            ("sudo rm -rf", "sudo rm -rf /usr/local/foo"),
            ("rm -r build/tmp", "rm -r build/tmp"),
            ("diskutil eraseDisk", "diskutil eraseDisk APFS Blank /dev/disk4"),
            ("diskutil apfs deleteVolume", "diskutil apfs deleteVolume disk3s5"),
            ("dd to raw device", "sudo dd if=/dev/zero of=/dev/rdisk4 bs=1m"),
            ("newfs", "newfs_apfs /dev/disk4s1"),
            ("tmutil delete", "sudo tmutil delete /Volumes/Backup/2026-01-01-000000"),
            ("csrutil disable", "csrutil disable"),
            ("killall ClashX", "killall ClashX"),
            ("pkill mihomo", "pkill -9 mihomo"),
            ("kill $(pgrep sing-box)", "kill -9 $(pgrep sing-box)"),
            ("killall Surge", "killall 'Surge'"),
            ("launchctl bootout clash", "launchctl bootout gui/501/com.metacubex.ClashX.ProxyConfigHelper"),
            ("launchctl unload sing-box", "sudo launchctl unload /Library/LaunchDaemons/io.nekohasekai.sing-box.plist"),
            ("systemctl stop mihomo", "sudo systemctl stop mihomo"),
            ("osascript quit Stash", "osascript -e 'quit app \"Stash\"'"),
            ("networksetup set web proxy", "networksetup -setwebproxy Wi-Fi 127.0.0.1 7890"),
            ("networksetup proxy state off", "networksetup -setsecurewebproxystate Wi-Fi off"),
            ("networksetup wifi power off", "networksetup -setairportpower en0 off"),
            ("ifconfig down", "sudo ifconfig en0 down"),
            ("ip link down", "sudo ip link set eth0 down"),
            ("ipconfig set none", "sudo ipconfig set en0 NONE"),
            ("route flush", "sudo route -n flush"),
            ("route delete default", "sudo route delete default"),
            ("pfctl disable", "sudo pfctl -d"),
            ("pfctl flush all", "sudo pfctl -F all"),
            ("nmcli networking off", "nmcli networking off"),
        ]
        for idx, (label, cmd) in enumerate(unix_deny_cases):
            check(label, cmd, "deny", conversation="s5-deny-%d" % idx)

        unix_pass_cases = [
            ("read-only networksetup get", "networksetup -getwebproxy Wi-Fi"),
            ("read-only networksetup list", "networksetup -listallnetworkservices"),
            ("read-only scutil --proxy", "scutil --proxy"),
            ("read-only pgrep proxy", "pgrep -fl 'clash|mihomo|sing-box'"),
            ("read-only launchctl list", "launchctl list | grep -i clash"),
            ("read-only ifconfig", "ifconfig en0"),
            ("read-only route get", "route -n get default"),
            ("read-only diskutil list", "diskutil list"),
            ("rm single file", "rm build/output.log"),
            ("brew install", "brew install jq"),
        ]
        for idx, (label, cmd) in enumerate(unix_pass_cases):
            check(label, cmd, PASS_DECISION, conversation="s5-pass-%d" % idx)

    print()
    print("=" * 78)
    failed = [r for r in results if not r[0]]
    print("TOTAL %d   PASS %d   FAIL %d" % (len(results), len(results) - len(failed), len(failed)))
    if failed:
        for _, label, exp, got, cmd in failed:
            print("  FAILED %s: expected %s got %s  [%s]" % (label, exp, got, cmd))
    print("=" * 78)

    # Verify audit log behavior: zero ERROR-FAILOPEN, zero ASK/ALLOW plaintext entries, and secret redaction
    if os.path.isfile(LOG):
        with open(LOG, "rb") as fh:
            data = fh.read().decode("utf-8", errors="replace")
        n_err = data.count("ERROR-FAILOPEN")
        print("ERROR-FAILOPEN entries in log: %d %s" % (n_err, "(must be 0)" if n_err else "(clean)"))
        if n_err:
            for ln in data.splitlines():
                if "ERROR-FAILOPEN" in ln:
                    print("   ", ln[:300])
            sys.exit(1)
        if "sk-secret1234567890" in data:
            print("FATAL: plaintext secret leaked into hook_log.jsonl!")
            sys.exit(1)
        if '"verdict":"ASK"' in data or '"verdict":"ALLOW"' in data:
            print("FATAL: non-blocked commands should not be logged by default!")
            sys.exit(1)
        print("Audit log privacy & secret redaction check: PASS")

    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()

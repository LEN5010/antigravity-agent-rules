---
name: safe-network-diagnostics
description: 当任务涉及网络连通性排查、本地代理客户端状态检查、DNS解析测试、端口探测或接口请求报错诊断时使用。固化用户代理严格只读红线与安全只读诊断命令规范。
---

# 安全网络与代理只读诊断规范（safe-network-diagnostics）

> 权威来源：继承自 [`~/.gemini/GEMINI.md`](file:///<YOUR_PATH>/.gemini/GEMINI.md)「用户代理与网络配置：未经许可一律只读」全局红线。命令行底层硬拦截位于 [`~/.gemini/config/scripts/pretool_guard.ps1`](file:///<YOUR_PATH>/.gemini/config/scripts/pretool_guard.ps1)。

## 1. 绝对红线：未经当次明确许可，严禁任何写/停操作

未经用户**当次明确许可**，严禁执行任何停止、禁用、重启、卸载用户代理或更改网络配置的操作，包括但不限于：

1. **严禁结束代理客户端进程**：
   - 严禁使用 `taskkill` / `pkill` / `Stop-Process` / `wmic` 针对以下目标：`clash`、`verge`、`mihomo`、`sing-box`、`v2ray`、`xray`、`neko`、`shadowsocks`、`hysteria` 等一切代理核心与 GUI 进程。
2. **严禁停止或删除相关 Windows 服务**：
   - 严禁执行 `sc stop`、`net stop`、`Stop-Service`、`sc delete` 等影响代理/TUN 服务的命令。
3. **严禁破坏性网络层操作**：
   - 严禁禁用网卡、断开连接或清空路由：`netsh wlan disconnect`、`Disable-NetAdapter`、`ipconfig /release`、`rasdial /d`、`route delete`。
4. **严禁修改系统代理设置**：
   - 严禁通过 `reg add` / `Set-ItemProperty` 修改 `HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings`（`ProxyEnable` / `ProxyServer`），严禁执行 `netsh winhttp set proxy`。

---

## 2. 标准只读网络诊断 SOP

排查网络故障、代理连通性或接口超时问题时，**只允许使用只读命令与只读参数**：

### 2.1 检查系统代理配置（只读）
```bash
# 查询当前用户级系统代理注册表设置
reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyEnable
reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyServer

# 查询 WinHTTP 代理状态
netsh winhttp show proxy
```

### 2.2 检查本地代理端口监听状态（只读）
```bash
# 查看常见代理端口（如 7890, 7897, 1080, 10808, 2080 等）是否在监听
netstat -ano | grep -E "LISTENING" | grep -E ":(7890|7897|1080|10808|2080)\b"
```

### 2.3 HTTP/HTTPS 连通性探测（严格限制 GET / HEAD）
- **注意**：`curl` 本身支持上传与写请求，不能凭程序名当作只读保证；诊断时**仅限 `GET` / `HEAD` 类读取**，并加上超时控制（`-m` / `--connect-timeout`）：
```bash
# 只读探测响应头与状态码
curl -I -s -m 5 https://www.google.com | head -n 5
```

### 2.4 DNS 与基础路由查询（只读）
```bash
nslookup <domain>
ping -n 3 <host>
netsh interface ip show config
```

### 2.5 鉴别大体积工具调用导致的“假性流中断”
若报错为 `The stream was interrupted` 或 `stream idle timeout`，排查网络前先检查上一步是否正在发起大体积 `write_file`（如单次写入 >2,500 字的长篇小说、大文档或大文件）。Antigravity 的 `BidiGenerateContent` 流在服务端生成 Tool Call JSON 参数时采用整包缓冲，参数全部拼装完成前流处于 0 字节静默；当单次写入过大导致后台缓冲耗时超过 90~120s 时，会被网关或客户端空闲超时直接掐断——**这属于单次工具输出块过大，并非用户代理或网络故障**。遇到此类情况直接改用 `write_file` + `Append: true` 分块（单次 ≤1,500–2,000 字）写入即可，无需探测或重启代理。

---

## 3. 确需变更时的唯一合规路径

如果诊断结论证实**确实需要重启代理或修改网络配置**：
1. **立即停止自动执行**；
2. 向用户清晰说明：**要执行什么操作、为什么需要做、会产生什么影响**；
3. 等待用户当次明确批准后再执行，或直接提供命令请用户在自己的终端手动执行。

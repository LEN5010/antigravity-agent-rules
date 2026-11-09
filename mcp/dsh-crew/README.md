# dsh-crew — 把 DSH 智能体接进任意 MCP 客户端

- 版本：0.1.1
- 形态：MCP stdio server（JSON-RPC 2.0，按行分隔），单文件、零依赖 Node 脚本
- 作用：让 Antigravity 等 MCP 客户端把任务派给本机 DSH（DeepSeek Harness）智能体，并拿回最终回答
- 不需要 MCP SDK，不需要 npm install，本目录可直接进版本库

## 1. 来历与灵感来源

这一节写清楚它是怎么来的，方便判断可信度、也方便追溯。

| 项 | 内容 |
|---|---|
| 生成时间 | 2026-11-07 15:55（本地时区） |
| 生成者 | DSH 桌面端自身的 Agent，模型 `deepseek/deepseek-v4.1-flash-fast` |
| 触发指令 | 「把这个 mcp 机制 dsh-crew 接入，让反重力能调用你」 |
| 可溯会话 | `~/.dsh/sessions/--D-deepseek~0020Harness--/session-f7c10545-d0f7-41d1-b3ba-6bb55d8d1e40/`（41 步 / 40 次工具调用） |
| 设计参照 | 作者另一座自用的 MCP 桥 `wenyou-bridge`（2026-09-02 落地，未公开）。同为单文件零依赖 + MCP stdio + CLI 双模式 + 状态落盘；本桥**只沿用形态，未复用其任何代码** |
| 协议依据 | MCP 规范 `2025-06-18`（JSON-RPC 2.0 over stdio） |
| 后端依据 | 官方 [`@deepseek-ai/dsh-headless`](https://github.com/deepseek-ai/deepseek-harness) 的 `headless` profile 文档（BSD-3-Clause） |

**不是从任何开源项目复制的。** 会话记录里源码是作为代码字面量当场写出来的，没有「读某个文件再落盘」的动作；公开生态里也找不到同名的 `dsh_ask` / `dsh_sessions` / `dsh_status` / `dsh_forget` 工具组合。

沿用的只有**形态**，不是代码：一个 `.mjs` 文件、只用 Node 内建模块、MCP 请求按行解析、业务状态写一个 JSON、每个工具一个 `toolXxx(args)` 函数。这个形态的好处是任何人 `less` 一遍就能审完，不需要信任包依赖。

> **与同仓库另一座桥的关系**：`../agent-bridge` 是通用版——后端可插拔（`BRIDGE_CMD` 指谁就是谁），但只做过假后端的协议验证，没接过真实后端。本桥绑死 DSH，换来的是**真机跑通 6/6**。要接 DSH 用本桥；要接别的 CLI 用那座，并自行补真实后端验证。

## 2. 后端机制

复用官方一次性任务模式 `dsh --profile headless`：

    dsh --profile headless --patch <凭据补丁> [--patch <模型补丁>] --json - \
        --permission-mode <档> --approval-policy never [--session-id <id>]

- 任务经 **stdin** 传入 —— 绕开引号、换行、中文标点在 `cmd` 里被二次转义
- `--json` 输出 NDJSON 事件流，桥只取最后的 `final` 事件作为回答；用法错误时取 `error` 事件的 `message`
- `--session-id` 延续同一段对话
- `--patch <凭据补丁>` 让 headless 复用桌面端已保存的 API 凭据（headless 默认禁用托管凭据存储，不加会报 `MISSING_CREDENTIAL`）
- `--patch <模型补丁>` 只在本机存在 `dsh-commandcode` 插件时追加，把默认模型切到 Command Code 的 `deepseek/deepseek-v4.1-flash-fast`；没有该插件时不传，沿用 DSH 自身的默认模型
- **启动器级选项（`--profile` / `--patch`）必须排在 app 参数（`--json` 等）之前**，否则 headless 报 `unknown option '--patch'`
- **dsh 版本要求**：headless 需要支持 `--json` / `--session-id` / `--permission-mode` / `--approval-policy`。实测 npm 版 `@deepseek-ai/dsh@0.2.2-rc.1` 支持，`0.1.5-rc.2` 不支持。`dsh_status` 的 `headless_cli` 项会用 `dsh --profile headless --help` 检查（不跑任务、不花 token）

### 平台差异

| | Windows | macOS / Linux |
|---|---|---|
| 启动器 | 桌面端 `resources/runtime/cli/bin/dsh.cmd`，或 npm 全局 `dsh.cmd` | 桌面端 `.app/Contents/Resources/runtime/cli/bin/dsh`，或 npm 全局 `dsh` |
| 启动方式 | 经 `cmd.exe`（`.cmd` 必须走 shell），启动器路径和参数里带空格的都加引号 | 直接 exec，不经 shell，`/Applications/<产品名>.app` 这类带空格的路径不会被拆开 |
| PATH | 原样继承，末尾追加当前 node 所在目录 | 同左。从 Dock 启动的 GUI 客户端 PATH 里通常没有 Homebrew 的 node，npm 版 `dsh` 的 `#!/usr/bin/env node` 需要这一步才能找到 node |
| 插件 URL | `file:///C:/Users/...` | `file:///Users/...`（由 `pathToFileURL` 生成） |

## 3. 工具

| 工具 | 作用 |
|---|---|
| `dsh_ask` | 派任务给 DSH。参数：`task`（必填）、`session`（标签，默认 `default`）、`cwd`（默认桥进程当前目录）、`permission`（`read-only` / `workspace-write` / `danger-full-access`，默认 `workspace-write`）、`approval_policy`（默认 `never`）、`timeout_ms`（默认 15 分钟，范围 10s–60min） |
| `dsh_sessions` | 列出已保存的 crew 会话（标签 / session_id / cwd / 次数 / 上次是否成功） |
| `dsh_status` | 自检后端：启动器、headless 参数支持（首次会执行一次 `dsh --profile headless --patch <凭据补丁> --help`，不花 token，成功后进程内缓存）、asar（仅参考）、凭据补丁（自检前先落盘）、模型补丁是否启用、工作目录、状态文件位置 |
| `dsh_forget` | 忘记某个会话标签（只删映射，不动 DSH 会话数据） |

返回文本固定含 `crew_session` / `session_id` / `cwd` / `permission` / `exit_code`；成功时附 `== DSH answer ==` 与 token 用量，失败时附 `== DSH error ==` 与 stderr 尾部。

## 4. 安装

```bash
# 1) 确认 DSH 启动器能被找到（装法不同目录名不同，找不到就显式指定）
export DSH_CREW_DSH_CMD="<DSH安装目录>/resources/runtime/cli/bin/dsh.cmd"   # Windows 桌面端
# export DSH_CREW_DSH_CMD="/Applications/<产品名>.app/Contents/Resources/runtime/cli/bin/dsh"  # macOS 桌面端
# 没装桌面端时也可以用 npm 版：npm i -g @deepseek-ai/dsh@0.2.2-rc.1（桥会在 PATH、当前 node 目录、/opt/homebrew/bin、/usr/local/bin、~/.volta/bin 里找 dsh）

# 2) 协议层自检，不启动 DSH、不花 token
node verify.mjs --offline

# 3) 全量验收（会真的跑两轮 DSH，耗 token）
node verify.mjs

# 4) 注册进 Antigravity（改前自动备份）
node register-antigravity.mjs "D:/my/project"   # 参数可省略
```

第 4 步也可以手工写进 `~/.gemini/config/mcp_config.json`：

```json
"dsh-crew": {
  "command": "/absolute/path/to/node",
  "args": ["/absolute/path/to/dsh-crew.mjs", "mcp"],
  "env": { "DSH_CREW_WORKSPACE": "D:/my/project" }
}
```

生效条件：重启 Antigravity 或新开对话后，MCP 面板出现 `dsh-crew`。

## 5. 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `DSH_CREW_DSH_CMD` | 自动探测 | DSH headless 启动器。先找桌面端：Windows `%LOCALAPPDATA%\Programs\*` 与 `C:\Program Files\*`，macOS `/Applications/*.app/Contents` 与 `~/Applications/*.app/Contents`，Linux `/opt/*`；再找 npm 全局安装的 `dsh`（PATH、当前 node 所在目录，非 Windows 另加 `/opt/homebrew/bin`、`/usr/local/bin`、`~/.volta/bin`）。都找不到就必须显式给 |
| `DSH_CREW_DSH_ASAR` | 由启动器反推 | 只在 `dsh_status` 里作参考信息，不影响运行，也不计入 `ready`（npm 安装没有 asar） |
| `DSH_CREW_COMMANDCODE_PLUGIN` | `~/.dsh/profiles/desktop/node_modules/dsh-commandcode/index.js` | 该文件存在时才叠加 `crew-commandcode.patch.yml` |
| `DSH_CREW_WORKSPACE` | 桥进程 cwd | `dsh_ask` 的默认工作目录 |
| `DSH_CREW_CRED_PATCH` | `~/.dsh/dsh-crew/crew-credentials.patch.yml` | 凭据补丁生效位置（放无空格路径，避免 cmd 引号问题） |
| `DSH_CREW_STATE_DIR` | `./state` | 标签 → session_id 映射存放处 |
| `DSH_CREW_TIMEOUT_MS` | `900000` | 单轮默认超时 |

## 6. 文件与状态

- `dsh-crew.mjs`：桥本体，约 570 行
- `crew-credentials.patch.yml`：凭据补丁源文件，只含官方文档里的三条开关，不含本机路径，桥每次派任务前原样落盘到 `DSH_CREW_CRED_PATCH`
- `crew-commandcode.patch.yml`：可选的模型补丁。里面的 `<COMMANDCODE_PLUGIN_URL>` 是占位符，桥用 `pathToFileURL` 替换后落盘到 `DSH_CREW_CRED_PATCH` 同目录；插件不存在时不落盘也不传
- `state/crew-state.json`：标签 → session_id 映射（桥自己维护，与 DSH 会话数据无关）
- `verify.mjs`：协议层 / 端到端验收
- `register-antigravity.mjs`：注册进 Antigravity 全局 MCP 配置，自动备份到 `./backups/`

## 7. 边界与已知限制

- crew 会话是**独立的 DSH 会话**：同一套工作区、规则、技能与工具，但不是桌面端正在跑的那个对话。headless 运行器按设计拒绝接管被存活 Agent 持有的会话，所以**不会打断桌面端当前对话**。
- `approval_policy` 默认 `never`：无人值守时，需要人工审批的动作直接拒绝，不挂起。
- 同一桥进程内的调用串行排队（避免两个进程同时驱动一个 session）；不同客户端进程各写一次状态文件属于最后写入生效，不影响 DSH 侧数据。
- 单轮超时默认 15 分钟，超时 SIGKILL 并返回 `TIMEOUT`。
- headless 每轮冷启动一个进程（数秒），首轮输入 token 约 12k（工作区 `AGENTS.md` 等指令会加载）。
- 只支持一次性任务（stdin 写完即关），不做常驻会话与并行 fan-out。
- headless 的 `--session-id` 要求工作目录与该会话首次运行时一致。同一个 `session` 标签换了 `cwd` 再调用，headless 会拒绝续接并报错；换目录时请换一个标签。

## 8. 许可

本目录沿用仓库根目录的 [MIT License](../../LICENSE)。

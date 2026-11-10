---
name: multi-agent-orchestrator
description: 当任务涉及多子代理（Subagents）分工、/swarm（或 /teamwork）多代理并行协作、默认派 3.8f（model: flash）子代理干脏活/只读验证、大型代码库跨模块检索、需要保持主对话上下文干净、需要利用独立工作区（branch/share）做无污染实验、或需要通过 MCP 遥控外部客户端 Agent（<YOUR_HEADLESS_MCP> / <YOUR_GUI_MCP>）时使用。指导何时及如何委派 flash-verifier、research、<YOUR_DOMAIN_VERIFIER>、自建 subagent 以及外部 MCP。
---

# 多 Agent 委派与跨端协同规范（multi-agent-orchestrator）

> 权威来源：遵守 [`~/.gemini/config/plugins/anyi-global-rules/rules/AGENTS.md`](file:///<YOUR_PATH>/.gemini/config/plugins/anyi-global-rules/rules/AGENTS.md) 边界与 [`BACKGROUND-RESOURCES.md`](file:///<YOUR_PATH>/.gemini/config/plugins/anyi-global-rules/rules/BACKGROUND-RESOURCES.md) 后台资源管理纪律。

## 1. 核心目标：保护主会话上下文与注意力

主 Agent 的上下文窗口是最宝贵的推理资源。以下场景应优先委派给 Subagent（默认优先使用 3.8f / `model: flash`）或外部协同 Agent（MCP），避免主上下文被海量中间日志、长篇搜索结果或重复校验输出污染：

1. **通用只读验证、日志筛查与哈希对账**（跑检查脚本、核对备份 SHA-256、排查长日志）→ 默认委派给全局 3.8f 专员 [`flash-verifier`](file:///<YOUR_PATH>/.gemini/config/plugins/anyi-global-rules/agents/flash-verifier.md)（若在特定工程中也可委派给领域专员 [`<YOUR_DOMAIN_VERIFIER>`](file:///<YOUR_PROJECT_PATH>/.agents/agents/<YOUR_DOMAIN_VERIFIER>.md)）。
2. **广度代码/文档检索**（跨多个目录搜寻调用链、查找历史实现、盘点多文件结构）→ 委派给内置只读 `research` subagent（可指定 `Model: "flash"`）。
3. **无污染隔离实验**（尝试高风险重构或对比不同实现方案，不希望弄脏当前工作树）→ 使用 `Workspace: "share"` 或 `"branch"` 启动 `self` subagent。
4. **跨客户端外部 Agent 遥控（MCP）**：
   - **遥控无头 Agent（`<YOUR_HEADLESS_MCP>` MCP）**：需复用 `<YOUR_PROJECT_PATH>` 工具链、让无头 Agent 跑长文本/批处理/脚本验证或无 UI 后台任务时使用。
   - **遥控桌面端 Agent（`<YOUR_GUI_MCP>` MCP）**：需将独立功能模块交给外部桌面 Agent 开发并执行 Git 基线客观验收 + 自动返修闭环（可选：如果你有共享待办文件，也用于推进其中归属外部 Agent 的任务）时使用（详细编排规程见 [`<YOUR_GUI_MCP>` Skill](file:///<YOUR_PROJECT_PATH>/.agents/skills/<YOUR_GUI_MCP>/SKILL.md)）。

---

## 2. 内部 Subagent 选型与模型分级策略

| 子代理类型 | 推荐 `Model` | 推荐 `Workspace` | 适用场景与权限边界 |
| :--- | :--- | :--- | :--- |
| **`flash-verifier`**（全局） | 内置设为 `flash` (3.8f) | `inherit` | **所有项目通用**：跑只读校验脚本、核对备份/产物 SHA-256、筛查长日志与定位行号。纯只读，只回结论与 `文件:行号`。 |
| **`<YOUR_DOMAIN_VERIFIER>`**（项目级） | 内置设为 `flash` (3.8f) | `inherit` | `<YOUR_PROJECT_PATH>` 专项工程专用：跑 `<YOUR_CHECK_SCRIPT>`、校验备份哈希。 |
| **`research`**（内置） | `flash` / `inherit` | `inherit` | 广度代码探索、多文件搜索与阅读。运行在只读沙箱中，无写入权限，安全零副作用。 |
| **自定义只读专员** (`define_subagent`) | `flash` / `flash_lite` | `inherit` | 需要反复执行的专项检查（如批量格式合规检查、分片对账）。定义时设 `EnableWriteTools: false`。 |
| **`self`（并行施工/实验）** | `inherit` | `share` 或 `branch` | 独立子模块开发或隔离验证。`share` 共享底层仓库（类 git worktree），避免全量复制开销且互不干扰。 |

> **纪律**：
> - 日常高频扫描、只读验证和检索脏活优先走 `flash`（3.8f）子代理（如 `flash-verifier`）；需要主模型同等级深度推理或代码施工的子任务用 `Model: "inherit"`。
> - **4c / 4a 配额与档位分流**：当主会话运行在 `Gemini 4 Carbon` 时，仅将跨子系统架构重构、深层根因排查、安全审计与形式化/多步验证留在 4c（`High` / `Medium`）；常规单模块施工、高频问答或 Pro 订阅环境优先使用 `Gemini 4 Argon`（`Medium` / `Low`），避免在轻量任务上烧穿 5 小时与周配额。

### 2.1 原生 `/swarm`（或 `/teamwork`）并行编排与对抗性验收纪律

当在 Antigravity 中启用 `/swarm`（桌面端斜杠菜单亦显示为 `/teamwork`）驱动多代理并行协作时，除遵守 §3 通信纪律外，必须额外执行以下三条边界控制：

1. **角色分层（架构/审计与施工解耦）**：
   - 优先由 `Gemini 4 Carbon` 承担顶层架构拆解、跨代理任务协调与终态对抗性验收（Adversarial Verifier，核查边界条件、回归风险与安全漏洞）；
   - 具体子模块的并发编码、单测补全与只读扫描下放给并行子代理（`Gemini 4 Argon` 或 `Gemini 3.8 Flash`）。
2. **互斥写入作用域（Disjoint Write Scopes）**：
   - 并行启动多个带写权限的施工代理时，派单提示词中**必须显式声明各自允许修改的目录或文件白名单**，严禁两个并行代理同时修改同一文件或共享全局配置；优先配合 `Workspace: "share"` 或 `"branch"` 隔离工作树，待验收通过后再统一合入。
3. **诚实阻塞透传**：
   - 若并行子代理遇到证据缺失或前置依赖冲突，必须原样回传 `BLOCKED` 与具体缺失项清单，禁止子代理自行猜测补齐接口契约。

---

## 3. 内部 Subagent 委派契约与通信纪律（Prompt & Reactive Wakeup）

1. **指令清晰（Prompt 契约）**：
   - 调用 `invoke_subagent` 时，必须明确告知子代理：
     - **具体目标与范围**（查哪些目录/脚本，不查哪些）；
     - **只读或写入边界**（严禁触碰的红线文件）；
     - **返回格式要求**（例如：“只返回结论、`文件:行号` 及不超过 40 行的证据摘要”）。
2. **禁止轮询（Reactive Wakeup）**：
   - 启动 Subagent 后，系统会在其完成或发消息时自动唤醒主会话；**严禁在主会话写循环、sleep 或反复轮询状态**。
3. **复用已有 Subagent**：
   - 同一子任务的后续追问或补充验证，使用 `send_message` 发送给已有 `conversationId`，不要重复启动新实例。
4. **生命周期收尾**：
   - 若子代理卡死或任务已取消，使用 `manage_subagents`（`Action: "kill"`）精准终止本任务自建的 `conversationId`。

---

## 4. 跨客户端外部 Agent 协同（`<YOUR_HEADLESS_MCP>` & `<YOUR_GUI_MCP>` MCP）

当任务需要跨客户端调度本机外部无头或桌面 GUI Agent 时，通过 `call_mcp_tool` 调用对应 MCP Server：

| MCP ServerName | 驱动目标与形态 | 核心工具 | 典型适用场景 |
| :--- | :--- | :--- | :--- |
| **`<YOUR_HEADLESS_MCP>`** | **Headless Agent**（独立子进程，不打断桌面 GUI） | `status` / `sessions` / `ask` / `forget` | 交由外部 Headless Agent 执行脚本检查、只读探测、文档处理或 `<YOUR_PROJECT_PATH>` 工作区任务。 |
| **`<YOUR_GUI_MCP>`** | **外部桌面 GUI Agent**（Electron CDP 驱动 + Git 基线客观验收） | `query_info` / `run_task` / `wait_task` / `query_task` / `manage_task` / `verify_task` | 派发完整开发任务书给外部 GUI Agent，自动跑命令验收与失败返修闭环。 |

这两个是**占位符**，填你实际的 MCP ServerName。本仓库自带两座零依赖桥，可直接用作 `<YOUR_HEADLESS_MCP>`：

| 占位符 | 本仓库可填 | 工具名对应 | 验证状态 |
| :--- | :--- | :--- | :--- |
| `<YOUR_HEADLESS_MCP>` | [`mcp/dsh-crew`](../../mcp/dsh-crew/) | `dsh_status` / `dsh_sessions` / `dsh_ask` / `dsh_forget`（语义即上表 `status` / `sessions` / `ask` / `forget`） | 真机跑通 6/6，含续聊复用 session |
| `<YOUR_HEADLESS_MCP>` | [`mcp/agent-bridge`](../../mcp/agent-bridge/) | `agent_status` / `agent_sessions` / `agent_ask` / `agent_forget`，后端由 `BRIDGE_CMD` 决定 | 假后端 32/32 协议断言，**未接真实后端** |
| `<YOUR_GUI_MCP>` | 本仓库暂不提供 | — | — |

注册写法见各目录 README。如果你不用外部 Agent，把本节连同 §4.1 / §4.2 一起删掉即可，不影响其余部分。

### 4.1 `<YOUR_HEADLESS_MCP>` 操作纪律
1. **最小权限原则**：只读排查、状态探测一律显式传 `permission: "read-only"`；仅在授权修改工作区文件时传 `"workspace-write"`；跨目录授权施工才传 `"danger-full-access"`，且 `approval_policy` 默认保持 `"never"`。
2. **会话标签卫生**：按任务语义命名 `session` 标签（以便多轮续聊同一上下文）；一次性探针或临时任务结束后，主动调用 `forget(session)` 清理映射。
3. **遵守目标工程红线**：派给外部 Agent 的任务必须遵守 [`<YOUR_PROJECT_PATH>/AGENTS.md`](file:///<YOUR_PROJECT_PATH>/AGENTS.md)（<YOUR_PROJECT_REDLINES>、严禁裸改生产红线配置、严禁触碰用户梯子）。

### 4.2 `<YOUR_GUI_MCP>` 操作纪律
1. **动手前先读专项 Skill**：使用 `<YOUR_GUI_MCP>` 派发开发或验收任务前，先读取 [`<YOUR_GUI_MCP>` Skill](file:///<YOUR_PROJECT_PATH>/.agents/skills/<YOUR_GUI_MCP>/SKILL.md)（工具 Schema 位于 [`~/.gemini/antigravity/mcp/<YOUR_GUI_MCP>/`](file:///<YOUR_PATH>/.gemini/antigravity/mcp/<YOUR_GUI_MCP>/run_task.json)）。
2. **标准闭环流程**：
   - 先调 `query_info(type="profiles")` 确认目标 Agent 状态为 `[PASS] 可用`；
   - 调 `run_task` 异步派单（按需指定 `model="<PROVIDER>/<MODEL>"`）；
   - 紧接调 `wait_task(taskId)` 阻塞等待到达停点（终态或 `needs_user`），终态后调 `query_info(type="report", taskId)` 读取客观验收报告。
3. **严禁强杀用户 GUI 窗口**：若返回 `needsUserKind: "close_existing_instance"`（检测到未开启 CDP 端口的既有客户端窗口），如实请用户保存并关闭旧窗口后再调 `manage_task(action="continue")`，绝不自行 `taskkill` 用户打开的客户端。

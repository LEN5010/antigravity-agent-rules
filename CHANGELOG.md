# Changelog

## [1.2.3] - 2026-11-11

- **放宽隔离工作树（`branch` / `share`）批量改动拦截**：
  - 更新 `global/AGENTS.md`（§1 动作分级）与 `skills/multi-agent-orchestrator/SKILL.md`（§2.1）：明确主工作树单次修改 ≥5 个文件属于“先问再动”，但当子代理或 `/swarm` Worker 运行在 `branch` / `share` 隔离 Git worktree 且尚未合入主分支时，允许在授权写入白名单内直接执行批量修改，统一留在 Adversarial Verifier 终审与合入主分支前由用户一次性拍板。
- **按运行模式豁免思考可见性前置播报**：
  - 更新 `global/THINKING-VISIBILITY.md` 与 `agents/flash-verifier.md`：区分主会话交互与后台并行执行——主会话直面用户时保留每次工具调用前 1–2 句前置判断；对 `/swarm` 并行执行 worker、`flash-verifier`、`research` 等后台子代理免除逐次工具前置播报，直接静默执行工具链，降低高单价模型输出开销与看板噪音。
- **补齐并发度与本地资源硬上限 + `read_loop_guard.cjs` 升级与并行评估**：
  - 更新 `skills/multi-agent-orchestrator/SKILL.md`（§2.1）与 `rules/BACKGROUND-RESOURCES.md`：新增单次任务活跃施工子代理并发上限（≤2–3 个，总活跃子代理 ≤3–4 个）及本机重型编译/打包/渲染/全量测试子进程并发硬上限（≤1–2 个，共享产物目录/端口/锁时强制 `max=1` 串行化），防止 `Gemini 4 Carbon` 在重型并行任务上吃满本机 CPU 与内存。
  - 更新 `hooks/hooks.json` 与 `hooks/scripts/read_loop_guard.cjs`：补齐对 Antigravity 2.0 原生工具名（`read_file` / `edit_file` / `write_file`）、省略 `EndLine` 的整文件读取检测及 `read_loop_log.jsonl` 5 MB 自动轮转（`.1`）的支持；经评估 `/swarm` 看板唤醒的 transcript epoch 边界、同会话并发锁竞争（`STATE_BUSY`）及 Ask-First 模式下的 `PreToolUse` `allow` 副作用，`read_loop_settings.json` 继续保持 `"mode": "observe"`（`enforce` 维持 `NOT_PROVEN`）。
- **新增对外文档交付润色串联与前端 UI 密度约束**：
  - 更新 `skills/docx-delivery/skills/docx-delivery/SKILL.md`：区分“既有文本原样转换”与“Agent（如 `Gemini 4 Carbon`）撰稿的对外客户文档交付”，后者在转出终版 `.docx` 前默认串联 `humanizer-zh`（或交由 `Gemini 4 Argon` 终审润色），定稿后再跑转换与 `validate_docx.py` 校验。
  - 更新 `rules/IMPLEMENTATION.md`：新增「前端与 UI 交付密度约束」，限制单个视图内视觉容器嵌套层级 ≤3 层、单行并列卡片 ≤3–4 个、单卡核心指标 ≤3 项，次要诊断参数与长日志默认折叠或下沉至二级详情抽屉。

## [1.2.2] - 2026-11-11

- **针对 Gemini 4 Carbon（4c）与 `/swarm` 并行编排的增量适配（`global/` 常驻层零改动）**：
  - 更新 `skills/multi-agent-orchestrator/SKILL.md`：补充 `Gemini 4 Carbon` / `Gemini 4 Argon` 配额与思考档位分流纪律；新增 §2.1 原生 `/swarm`（桌面端斜杠菜单亦作 `/teamwork`）并行编排与对抗性验收纪律，明确角色分层（Carbon 统筹架构与终态审计、Argon/Flash 并发施工与扫描）、互斥写入作用域（`Disjoint Write Scopes`，显式白名单 + `share`/`branch` 隔离工作树）及诚实阻塞透传要求。
  - 更新 `skills/chinese-novelist/SKILL.md`：补充 4c / 4a 分阶段模型协同建议（大纲推演与全书连续性核查可用 Carbon，逐章正文优先 Argon）；针对 Carbon 较长的内部推理耗时，将 `BidiGenerateContent` 分块 `write_file` 在 Carbon 下的单次字数上限收紧至 `1,000–1,500` 字（分 2–4 段落盘，下调至 `Low` / `Medium` 档位），并同步校准阶段 3 写作流程说明。
  - 更新 `README.md`：在适配模型版本矩阵（`VERIFIED`）中新增 `Gemini 4 Carbon` 说明，并同步更新文件总表中 `multi-agent-orchestrator` 的触发与职责摘要。

## [1.2.1] - 2026-11-10

- **新增工具调用前思考可见性常驻规则（`global/THINKING-VISIBILITY.md`）**：
  - 新增 `trigger: always_on` 规则文件 `global/THINKING-VISIBILITY.md`：要求每次发起工具调用或连续执行多步操作前，先用 1–2 句简练文字说明当前的分析判断、调用原因及预期验证问题，禁止静默连续调用工具。
  - 双端安装器（`install.ps1` 与 `hooks/unix/hooks-installer.mjs`）已同步接入，全量安装时自动部署至 `~/.gemini/config/plugins/anyi-global-rules/rules/THINKING-VISIBILITY.md`（亦可单独复制至 `~/.gemini/antigravity/rules/` 或工作区 `.agents/rules/` 独立使用）。
- **完善 README 边界与合规声明**：
  - 明确说明 `pretool_guard.ps1` / `pretool_guard.cjs` 对未命中黑名单命令默认返回 `{"decision":"allow"}` 的放行边界（适配 Turbo / Eager 模式，Ask-First 手动审批用户请勿原样启用该分支）。
  - 补充第三方开源 Skill 上游协议归属细节（含 `lieflat-less-ai-tone` V1 MIT 提交哈希与上游后续协议变更提示）及底部非官方社区项目免责声明。

## [1.2.0] - 2026-11-10

- **macOS / Linux 全量 5 层一键安装与跨平台规则补齐**：
  - 扩充 `hooks/unix/hooks-installer.mjs`（及根目录 `install.sh` / `uninstall.sh`）：默认支持与 `install.ps1` 完全对等的 **5 层全量安装（Full mode）**，自动无损合并 `~/.gemini/GEMINI.md`（按 `<!-- antigravity-agent-rules:begin/end -->` 标记）与 `~/.gemini/config/hooks.json`、部署 5 个插件到 `~/.gemini/config/plugins/`、部署独立 Skills 到 `~/.gemini/antigravity/skills/`（支持 `--workspace-path` 同步至工作区 `.agents/skills/`）、启用 `~/.gemini/config/config.json` 中的 5 个插件开关，并将 `<YOUR_PATH>` 与 `%USERPROFILE%\...` 路径占位符替换为 `$HOME` 正斜杠路径；保留 `--hook-only` 作为仅安装 Hook 层的可选参数，`uninstall.sh` 自动识别 `full` / `hook-only` 备份快照并完整还原。
  - 更新 `global/GEMINI.md`：将「Shell 偏好」改为按平台分流（Windows 下使用 Git Bash / `pwsh` 7；macOS / Linux 下直接使用系统原生 `zsh` / `bash`），并在「用户代理与网络配置：未经许可一律只读」中补充 macOS / Linux 下禁止停止的代理服务（`launchctl` / `systemctl` / `osascript ... quit`）与禁止修改的网络/代理命令（`networksetup -set*`、`scutil`、`ifconfig ... down`、`nmcli`、`pfctl`）。
  - 更新 `skills/safe-network-diagnostics/SKILL.md`：在 Windows（`reg query`、`netsh winhttp show proxy`、`netstat -ano`）旁完整补充 macOS（`scutil --proxy`、`networksetup -getwebproxy Wi-Fi`、`lsof`、`scutil --dns`、`ifconfig`）与 Linux（`env | grep -i proxy`、`ss -tulnp`、`ip addr`、`ip route`）的只读网络诊断命令对照。
- **Hook 守卫层支持 macOS / Linux**（Windows 默认行为不变，仍使用 `pretool_guard.ps1`）：
  - 新增 `hooks/scripts/pretool_guard.cjs`：`pretool_guard.ps1` 的 Node 跨平台版，29 条通用/Windows 规则逐条一致，另加 17 条 macOS / Linux 规则（`diskutil erase*`、`dd of=/dev/`、`mkfs`/`newfs_*`、`tmutil delete`、`csrutil disable`；`kill`/`pkill`/`killall`/`launchctl`/`systemctl`/`osascript quit` 结束代理客户端；`networksetup -set*`、`ifconfig down`、`ipconfig set`、`route delete/flush/change`、`pfctl -d/-F`、`nmcli` 断网）。
  - `hooks.json` 在 macOS / Linux 安装时自动将命令改写为 Node 绝对路径，避免 GUI 启动的 Antigravity 找不到 `node`。
  - `verify-hook.py` 新增 `--guard ps|node`（非 Windows 默认 `node`），Node 版额外跑 38 项 macOS / Linux 用例，合计 78 项自检全通。
  - `install.ps1` / `uninstall.ps1` 的受管文件清单加入 `pretool_guard.cjs`，保证 Windows 卸载时一并清理。
- **`mcp/dsh-crew` 0.1.1 跨平台适配**：修复 macOS 上的四处运行问题，Windows 行为保持不变。
  - 非 Windows 平台改为直接 exec 启动器、不经 shell，`/Applications/<产品名>.app/...` 这类带空格的路径不再被拆开；Windows 仍经 `cmd.exe`，并给启动器路径本身加引号。
  - 凭据补丁拆成两份：`crew-credentials.patch.yml` 只保留官方三条开关；Command Code 默认模型移到 `crew-commandcode.patch.yml`，仅在本机存在 `dsh-commandcode` 插件时叠加。插件 URL 改用 `pathToFileURL` 生成，修复 macOS 上拼出 `file:////Users/...` 导致插件加载失败的问题。
  - 子进程 PATH 末尾追加当前 node 所在目录，修复 GUI 客户端启动时 npm 版 `dsh` 报 `env: node: No such file or directory`。
  - macOS 桌面端探测补充用户级 `~/Applications`；桌面端找不到时退回 PATH、当前 node 所在目录、`/opt/homebrew/bin`、`/usr/local/bin` 与 `~/.volta/bin` 中的 npm 版 `dsh`。
  - `dsh_status` 新增 `headless_cli` 检查（`--profile headless --patch <CRED_PATCH> --help`，不花 token，成功后按 `DSH_CMD` 在进程内存缓存），自检前先落盘补丁；`dsh_asar` 改为参考信息，不再计入 `ready`。
  - 解析 headless `--json` 流中的 `error` 事件（区分 `streamError` 与 `NO_FINAL_EVENT`），补齐 `runHeadless()` 的 `timeoutMs` 默认值；旧版 headless 不认识参数时给出升级提示。

## [1.1.0] - 2026-11-09

- 新增跨端 MCP 双桥（`mcp/`）：
  - `mcp/dsh-crew`：绑定 DSH（`dsh --profile headless`）的单文件零依赖 MCP stdio 桥，提供 `dsh_ask` / `dsh_sessions` / `dsh_status` / `dsh_forget`，通过 `verify.mjs` 6/6 真机验证（含 `--offline` 5/5 离线协议自检与同一 `session` 续聊复用）。
  - `mcp/agent-bridge`：零依赖可插拔通用 CLI MCP stdio 桥（后端由 `BRIDGE_CMD` / `BRIDGE_ARGS` 指定），提供 `agent_ask` / `agent_sessions` / `agent_status` / `agent_forget`，含假后端 32/32 协议断言自检（标注未接真实后端，与 `dsh-crew` 明确区分验证状态）。
- 更新 `skills/multi-agent-orchestrator/SKILL.md`：将 §4 中的 `<YOUR_HEADLESS_MCP>` 占位符对接至仓库内置的 `mcp/dsh-crew` 与 `mcp/agent-bridge` 双桥对照表；并在 `skills/chinese-novelist/SKILL.md` 与 `skills/safe-network-diagnostics/SKILL.md` 中补充 `BidiGenerateContent` 流式整包缓冲下的分块 `write_file`（单次 ≤1,500–2,000 字 + `Append: true`）规则与假性流中断鉴别说明。
- 补充 `skills/chinese-novelist/SKILL.md` 及 `UPSTREAM.md` 的上游开源归属说明（`PenglongHuang/chinese-novelist-skill`，MIT License），优化 `README.md` 开头「Antigravity 桌面端（IDE / 2.0）& agy CLI」跨端定位说明并新增底部「可选：跨端 MCP 桥（`mcp/`）」章节。

## [v1.0.2] - 2026-11-09

- `install.ps1` 新增 `-HookOnly`：只合并 `hooks.json` 并部署 `scripts/`，不改 `GEMINI.md`、`config.json` 和规则/Skill/文风层，自检照常运行。
- 备份 `manifest.json` 新增 `mode` 字段（`full` / `hook-only`）；`uninstall.ps1` 遇到 `hook-only` 时只还原 Hook 相关文件，不删用户自己的 `GEMINI.md` 与插件，也不改 `config.json`。

## [v1.0.1] - 2026-11-09

- 重写 README：开头讲清痛点与四条使用边界（仅支持 Windows、黑名单是安全网而非沙箱、Ask-First 下默认 allow 的注意事项、不要全量常驻），文件总表与手动部署步骤收进折叠块。
- 拦截提示、自检输出与规则文档中的措辞统一为“代理/网络配置”，拦截正则与判定逻辑不变。

## [v1.0.0] - 2026-11-09

- **首版公开发布（v1.0）**：完整整理并开源全套 Antigravity / Gemini Agent 分层治理与技能规则体系。
  - **历史溯源**：本套规则最早发布于 **百度贴吧·谷歌gemini吧（2026-09-29）**，经长期真实工程、自动化排障与多代理协同实战迭代定型。
- **五层 + 子代理架构定型**：
  1. **`hooks/`（底层硬拦截层）**：`hooks.json`、`pretool_guard.ps1`（危险破坏性命令与用户代理/网络配置只读硬拦截，解决中文 Windows PowerShell 5.1 标准输入 UTF-8/GBK 双字节吞反斜杠解析漏洞）、`read_loop_guard.cjs`（未变更文件同区间重复读取死循环诊断与拦截）及 `verify-hook.py` 回归自检套件。
  2. **`global/`（Always-on 全局宪法层）**：`GEMINI.md`（人机协作基调、防开盒与路径脱敏铁律、代理只读红线、Git Bash/pwsh 7 偏好、子代理派工原则）与 `AGENTS.md`（§1–§15 动作分级、`FAST_PATH`/`INVESTIGATION_PATH` 轮次纪律、禁仪式化严谨、停止与资源边界、交付契约、证据真实性、范围锁定及按需路由）。
  3. **`tone/`（去 AI 味文风层）**：按需加载的中文成稿创作与文本润色规范（`lieflat-less-ai-tone` 与 `humanizer-zh` 规则衔接版及上游 MIT 协议引用占位）。
  4. **`rules/`（按需 `model_decision` 专项规则层）**：`BACKGROUND-RESOURCES.md`（后台进程与 GUI 脱钩生命周期）、`IMPLEMENTATION.md`（诊断→施工切换）、`LONG-TASKS.md`（8 分钟长任务阶段可见性）、`RELEASE-PACKAGING.md`（冻结基线与完整依赖闭包）、`RULE-MAINTENANCE.md`（规则冻结原则）、`WINDOWS-RELEASE.md`（Windows 脚本编码与实跑验证）、`SEARCH-ROUTING.md`（外部检索路由）。
  5. **`skills/` & `agents/`（按需执行 SOP 与子代理层）**：`task-intake`（多步骤工程任务编译、状态机与四态回报）、`research-routing`（多源交叉检索 SOP）、`safe-network-diagnostics`（代理安全只读网络诊断）、`multi-agent-orchestrator`（多代理分工与跨端 MCP 协同）、`client-maintenance`（客户端缓存与陈旧会话归档维护）、`docx-delivery`（Markdown 转可编辑 Word 交付与校验）、`chinese-novelist`（长篇小说创作衔接定义）以及全局只读验证专员 `flash-verifier.md`。
- **一键部署与自检闭环**：
  - 提供根目录 `install.ps1` 一键安装脚本（前置校验 `config.json`/`hooks.json` 语法、列出修改项并经 `y` 确认或 `-Force` 跳过、自动备份原配置、按 `<!-- antigravity-agent-rules:begin/end -->` 标记与顶层键无损合并 `GEMINI.md` 及 `hooks.json`、替换 `<YOUR_PATH>`、按标准插件目录结构分发 5 层文件、启用 5 个插件并自动执行 `verify-hook.py` 40 项回归校验）。
  - 提供根目录 `uninstall.ps1` 一键卸载脚本（经 `y` 确认后从最近一次 `backup_antigravity_rules_*` 还原、删除安装前不存在的文件与插件目录、并仅移除 `config.json` 中本仓库的 5 个插件条目）。
  - `tone/lieflat-less-ai-tone`、`tone/humanizer-zh`、`skills/docx-delivery` 均已对齐为 `plugin.json` + `skills/<name>/SKILL.md` 标准插件层级。

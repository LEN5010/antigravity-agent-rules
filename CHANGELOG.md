# Changelog

## [v1.0.0] - 2026-11-09

- **首版公开发布（v1.0）**：完整整理并开源全套 Antigravity / Gemini Agent 分层治理与技能规则体系。
  - **历史溯源**：本套规则最早发布于 **百度贴吧·谷歌gemini吧（2026-09-29）**，经长期真实工程、自动化排障与多代理协同实战迭代定型。
- **五层 + 子代理架构定型**：
  1. **`hooks/`（底层硬拦截层）**：`hooks.json`、`pretool_guard.ps1`（危险破坏性命令与用户 VPN/代理只读硬拦截，解决中文 Windows PowerShell 5.1 标准输入 UTF-8/GBK 双字节吞反斜杠解析漏洞）、`read_loop_guard.cjs`（未变更文件同区间重复读取死循环诊断与拦截）及 `verify-hook.py` 回归自检套件。
  2. **`global/`（Always-on 全局宪法层）**：`GEMINI.md`（人机协作基调、防开盒与路径脱敏铁律、代理只读红线、Git Bash/pwsh 7 偏好、子代理派工原则）与 `AGENTS.md`（§1–§15 动作分级、`FAST_PATH`/`INVESTIGATION_PATH` 轮次纪律、禁仪式化严谨、停止与资源边界、交付契约、证据真实性、范围锁定及按需路由）。
  3. **`tone/`（去 AI 味文风层）**：按需加载的中文成稿创作与文本润色规范（`lieflat-less-ai-tone` 与 `humanizer-zh` 规则衔接版及上游 MIT 协议引用占位）。
  4. **`rules/`（按需 `model_decision` 专项规则层）**：`BACKGROUND-RESOURCES.md`（后台进程与 GUI 脱钩生命周期）、`IMPLEMENTATION.md`（诊断→施工切换）、`LONG-TASKS.md`（8 分钟长任务阶段可见性）、`RELEASE-PACKAGING.md`（冻结基线与完整依赖闭包）、`RULE-MAINTENANCE.md`（规则冻结原则）、`WINDOWS-RELEASE.md`（Windows 脚本编码与实跑验证）、`SEARCH-ROUTING.md`（外部检索路由）。
  5. **`skills/` & `agents/`（按需执行 SOP 与子代理层）**：`task-intake`（多步骤工程任务编译、状态机与四态回报）、`research-routing`（多源交叉检索 SOP）、`safe-network-diagnostics`（代理安全只读网络诊断）、`multi-agent-orchestrator`（多代理分工与跨端 MCP 协同）、`client-maintenance`（客户端缓存与陈旧会话归档维护）、`docx-delivery`（Markdown 转可编辑 Word 交付与校验）、`chinese-novelist`（长篇小说创作衔接定义）以及全局只读验证专员 `flash-verifier.md`。
- **一键部署与自检闭环**：
  - 提供根目录 `install.ps1` 一键安装脚本（前置校验 `config.json`/`hooks.json` 语法、列出修改项并经 `y` 确认或 `-Force` 跳过、自动备份原配置、按 `<!-- antigravity-agent-rules:begin/end -->` 标记与顶层键无损合并 `GEMINI.md` 及 `hooks.json`、替换 `<YOUR_PATH>`、按标准插件目录结构分发 5 层文件、启用 5 个插件并自动执行 `verify-hook.py` 40 项回归校验）。
  - 提供根目录 `uninstall.ps1` 一键卸载脚本（经 `y` 确认后从最近一次 `backup_antigravity_rules_*` 还原、删除安装前不存在的文件与插件目录、并仅移除 `config.json` 中本仓库的 5 个插件条目）。
  - `tone/lieflat-less-ai-tone`、`tone/humanizer-zh`、`skills/docx-delivery` 均已对齐为 `plugin.json` + `skills/<name>/SKILL.md` 标准插件层级。

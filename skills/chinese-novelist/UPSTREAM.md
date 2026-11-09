# 上游仓库与协议占位说明（`chinese-novelist`）

- **上游项目**：[PenglongHuang/chinese-novelist-skill](https://github.com/PenglongHuang/chinese-novelist-skill)
- **原始作者**：`PenglongHuang`
- **开源协议**：MIT License（`Copyright (c) 2026 PenglongHuang`，见同目录 [`LICENSE`](./LICENSE)）

## 本地收录范围与本仓库适配说明

本目录按原项目 MIT 协议仅保留：
1. [`LICENSE`](./LICENSE)：原项目 MIT 版权与许可声明原文；
2. [`SKILL.md`](./SKILL.md)：在上游四阶段创作框架基础上，针对本仓库全局规则与 Antigravity 客户端特性做出的本地衔接版入口，具体增量改动包括：
   - 衔接 `global/AGENTS.md` §4A 长任务阶段汇报、重写前原稿备份（`chapters/_prev/`）与 `lieflat-less-ai-tone` 去 AI 味自检；
   - **新增 Antigravity `BidiGenerateContent` 防断流分块落盘约束**：规避服务端整包缓冲大型 `write_file` JSON 参数（单次 >2,500 字）引发的 90~120s 零字节流静默中断（`The stream was interrupted` / `stream idle timeout`），要求每章 3,000–5,000+ 字正文按场景拆分为 2–3 段（单次 ≤1,500–2,000 字，配合 `Append: true`）落盘。

原仓库的 `references/flows/`（阶段详细流程）、`references/guides/`（写作指南与模板）及 `scripts/check_chapter_wordcount.py`（字数检查脚本）著作权归原项目作者所有，不在本仓库重复打包。使用时请先从上游仓库克隆并将 `references/` 与 `scripts/` 放入本目录：

```bash
git clone https://github.com/PenglongHuang/chinese-novelist-skill.git
```

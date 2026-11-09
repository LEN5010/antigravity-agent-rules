# 上游仓库与协议占位说明（`chinese-novelist`）

- **上游项目**：[PenglongHuang/chinese-novelist-skill](https://github.com/PenglongHuang/chinese-novelist-skill)
- **原始作者**：`PenglongHuang`
- **开源协议**：MIT License（见同目录 [`LICENSE`](./LICENSE)）

## 本地收录范围说明

本目录按原项目 MIT 协议仅保留：
1. [`LICENSE`](./LICENSE)：原项目 MIT 版权与许可声明；
2. [`SKILL.md`](./SKILL.md)：与本仓库全局规则（`global/AGENTS.md` §4A 长任务阶段汇报及 `lieflat-less-ai-tone` 去 AI 味自检）衔接后的精简入口定义。

原仓库的 `references/flows/`（阶段详细流程）、`references/guides/`（写作指南与模板）及 `scripts/check_chapter_wordcount.py`（字数检查脚本）不在本仓库重复打包。使用时请先从上游仓库克隆并将 `references/` 与 `scripts/` 放入本目录：

```bash
git clone https://github.com/PenglongHuang/chinese-novelist-skill.git
```

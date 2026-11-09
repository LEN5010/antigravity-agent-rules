# 上游仓库与协议占位说明（`lieflat-less-ai-tone`）

- **上游项目**：[larashero3-dotcom/lieflat-less-ai-tone](https://github.com/larashero3-dotcom/lieflat-less-ai-tone)
- **原始作者**：`shiujan` / `larashero3-dotcom`
- **收录基线版本**：基于上游 **V1（283 万字版，2026-08-20 首次提交，收录时对应上游 commit 哈希：[`27d29232f10124db904ca9c0536d0b67cb3b2833`](https://github.com/larashero3-dotcom/lieflat-less-ai-tone/tree/27d29232f10124db904ca9c0536d0b67cb3b2833)，提交时间 2026-08-24，当时开源协议为 MIT License）**。
- **重要协议变更说明**：上游已于 **2026-10-27 发布 V2 并改为 CC BY-NC 4.0**。本目录所含 V1 文件适用收录时的 MIT 协议（见同目录 [`LICENSE`](./LICENSE)）；**从上游主分支拉取的新版（V2）不适用 MIT、不可商用**。

## 本地收录范围说明

本目录仅按收录时（V1）的 MIT 协议保留：
1. [`LICENSE`](./LICENSE)：V1 原项目 MIT 版权与许可声明（`Copyright (c) 2026 shiujan`）；
2. [`plugin.json`](./plugin.json)：Antigravity 插件元数据；
3. [`skills/lieflat-less-ai-tone/SKILL.md`](./skills/lieflat-less-ai-tone/SKILL.md)：基于上游 V1（commit `27d29232f10124db904ca9c0536d0b67cb3b2833`）与本仓库全局规则（`global/AGENTS.md`）做过触发边界与分流衔接的规则正文。

原仓库 V1 的完整语料统计报告（`RESEARCH.md` / `RESEARCH.en.md`）、配图（`assets/`）及辅助统计脚本（`scripts/`）不在本仓库重复打包。如需获取与本目录同协议（MIT）的上游 V1 完整文件，请检出对应历史 commit：

```bash
git clone https://github.com/larashero3-dotcom/lieflat-less-ai-tone.git
cd lieflat-less-ai-tone
git checkout 27d29232f10124db904ca9c0536d0b67cb3b2833
```

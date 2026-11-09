---
name: chinese-novelist
description: 分章节创作中文中长篇小说（10–50 章），覆盖立项问答、大纲规划、逐章写作、续写未完成的小说项目和全书校验。用户要求写小说、写连载故事或继续之前的小说项目时使用。单篇短故事或润色已有文本不用本 Skill，改用 lieflat-less-ai-tone。
---

# 中文小说创作

## 写作原则

1. 用动作、对话和细节呈现人物状态，情绪结论不由叙述者直接宣布。
2. 每章至少一个冲突或转折，推动主线或人物关系。
3. 每章结尾留一个钩子：未解的问题、新的威胁或反转。
4. 人物、设定和时间线以 `01-大纲.md`、人物档案和 `03-连续性记录.md` 为准，前后不得矛盾。

## 与全局规则的衔接

- 项目文件夹建在当前工作区：`./chinese-novelist/{yyyyMMdd-HHmm}-{小说名}/`，不写工作区以外的路径。
- 第三、四阶段不向用户提问，但按全局 §4A 汇报进度：每完成一批章节（默认 5 章）报一句进度，汇报不暂停写作。
- 重写已完成章节属于覆盖已有成果。第二阶段确认时一并取得授权；重写前把原稿存到 `chapters/_prev/`。
- 去 AI 味：每章写完后按 lieflat-less-ai-tone 的规则自检，文学体裁豁免照常适用。不对全书做二次改写。

## 流程

进入每个阶段前，先读对应的流程文档。

### 0 初始化

读取用户偏好。工作区已有未完成项目（`02-写作计划.json` 里还有未完成章节）时，报告当前进度并从断点续写。不输出欢迎语。
→ [phase0-initialization.md](references/flows/phase0-initialization.md)

### 1 立项问答

- 必答 Q1–Q3：题材与创意、主角、核心冲突。用户已经说过的不再问。
- Q4–Q8（世界观、视角与基调、主题、目标读者、章数与每章字数）一次列出，每项附推荐默认值，用户回“默认”即可。
- 标题：给 3–5 个候选，用户选择或自拟。

→ [phase1-layer1-core.md](references/flows/phase1-layer1-core.md) / [phase1-layer2-customize.md](references/flows/phase1-layer2-customize.md) / [phase1-layer3-title.md](references/flows/phase1-layer3-title.md)

### 2 规划与确认

生成 `01-大纲.md`、人物档案、`02-写作计划.json`，以及空的 `03-连续性记录.md`。一次确认以下内容：大纲、章数与字数、写作模式、是否允许自动重写不合格章节。确认后不再提问。
→ [phase2-planning.md](references/flows/phase2-planning.md)

### 3 写作

- 模式：默认 `serial`，主 Agent 逐章写。`parallel` 只在运行环境能派生写作子代理时可选。
- 每章流程：读本章大纲、`03-连续性记录.md` 和上一章结尾约 500 字 → 写作 → 字数检查 → 去 AI 味自检 → 更新 `02-写作计划.json` 中的章节状态 → 在 `03-连续性记录.md` 追加本章摘要（≤150 字）、新埋的伏笔、已回收的伏笔和人物状态变化。

→ [phase3-writing.md](references/flows/phase3-writing.md)

### 4 全书校验

- 字数用共享机制里的检查脚本统计，与目标偏差在 ±10% 以内为合格。
- 字数不合格时，先在原章内扩写或删减。违背大纲或与连续性记录冲突时才整章重写。每章最多 3 轮。
- 结局：全部合格报 `PASS`；仍有不合格章节报 `FAIL`，列出章号和原因。

→ [phase4-validation.md](references/flows/phase4-validation.md)

## 共享机制

偏好系统、写作计划 JSON 结构、字数检查脚本。
→ [shared-infrastructure.md](references/flows/shared-infrastructure.md)

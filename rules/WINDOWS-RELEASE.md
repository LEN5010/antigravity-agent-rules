---
trigger: model_decision
description: "制作、修改或验证 Windows 交付物时读取：BAT/CMD/PowerShell 脚本、启动或关闭入口、中文交付文档及 Release 编码处理。施工前读取；仅在聊天中撰写中文或处理与 Windows 交付无关的 Markdown/文本不适用。"
---

# Windows 交付物规则

适用：Windows 上的 BAT / CMD / PowerShell 脚本、中文文档、Release 编码处理。

## 编码

- BAT / CMD 内容必须 **ASCII-only**（这是减少发布变量的兼容性约定，不是"任何非 ASCII BAT 必然失败"的技术定律）
- 禁止中文 echo、中文注释、emoji、Unicode 标点
- 不得依赖 `chcp 65001` 解决 BAT 解析问题
- 中文 TXT 为约定目标环境统一使用 **UTF-8 with BOM**，并在目标环境验证显示；不得把该约定说成所有记事本版本的必然要求（Windows 10 1903 / 2019 年 5 月更新起，Notepad 已支持并默认保存无 BOM UTF-8）
- JS / MJS / HTML / JSON / MD 使用 **UTF-8**
- 中文文件名允许存在
- PowerShell 脚本需兼容 Windows PowerShell 5.1 且含非 ASCII 内容时，明确使用 UTF-8 BOM；否则发布运维脚本优先用纯英文 ASCII

## 验证

- 发布前**实际执行**启动脚本与关闭脚本，不得仅做语法检查；可用目标解释器实跑验证（BAT/CMD 用 cmd 实跑，PowerShell 脚本用 powershell 实跑），不以 Shell 偏好阻止必要实跑
- 启动后确认服务持续可用（等待后再刷新仍可访问）
- 关闭后确认端口彻底释放
- 中文文档用记事本打开确认无乱码；无 GUI 条件时完成编码字节检查，并把真实记事本查看标为未验证（必需验收则影响整体结局，补充观察则进备注）
- 验证记录对象：目标 Windows 与解释器版本、测试目录、启动方式、健康检查结果、退出与端口归属；不为"端口彻底释放"误停无关进程

## 常见失败

- 编码、代码页与解释器设置不匹配时，BAT 可能出现解析失败或乱码（条件化风险，非必然）
- 旧版记事本打开缺 BOM 的 UTF-8 中文 TXT 可能乱码
- 只做静态检查未实跑 → 打包后才发现启动失败

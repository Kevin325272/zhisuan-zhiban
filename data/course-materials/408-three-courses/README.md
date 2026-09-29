# 408 三门课程源层数据

该目录保存数据结构、计算机操作系统、计算机网络三门课程的本地源层包。`raw/output.zip` 是用户提供文件的副本，原文件未移动或覆盖；`raw/` 被项目 `.gitignore` 忽略，运行环境需按 `manifest.json` 的 SHA256 自行准备。

## 当前边界

- 这是教材 OCR 切片、图示清单和正文图示关联，不是学生知识地图。
- 不把 chunk 直接显示为课程概念，不把图示清单直接作为学生图片库。
- `license_status=unverified`、`usage_scope=local_demo_only`，版权/公开分发授权尚未核验。
- `needs_human_review` 图示只进入后台源层记录，不作为可展示图片。
- 不含 QA 工作流、训练模型或真实 AI/RAG 接口；教材切片中的 exercise 仍只是来源文本。

## 验证与导入

在项目根目录运行：

```powershell
pnpm --filter @xuetu/api 408-source:validate
pnpm --filter @xuetu/api db:seed-408-source
```

导入写入独立的 PostgreSQL 源层表，不覆盖组成原理的课程化知识地图表。学生端课程目录在完成后续课程化整理前仍应显示“课程讲解资料待接入”。


# 408 三门课程源层接入说明

## 已接入范围

本批接入用户提供的 `output.zip` 副本，包含：

- 数据结构（C语言版·第2版）
- 计算机操作系统（第4版）
- 计算机网络（第8版）

运行时只使用 PostgreSQL 源层表；ZIP/JSON 是校验和导入源，不是运行时数据库。

真实校验结果：3 门课程、1,287 个 chunk、601 条图示资产、601 条正文关联；555 对 PNG/WebP 文件可用，46 条图示为 `needs_human_review`，暂不作为可展示图片。

## 数据边界

- `license_status=unverified`
- `usage_scope=local_demo_only`
- `student_content_status=source_layer_only_curriculum_pending`
- OCR chunk 仅作来源证据，不是课程知识点，不直接成为学生知识树节点。
- 本批没有导入 QA 工作流、训练模型或真实 AI/RAG。
- 原始图示 provenance 和 `raw_metadata` 保存在 PostgreSQL；学生端没有新的图示展示入口。

## 本地命令

在 `xuetu-mvp` 根目录执行：

```powershell
pnpm 408-source:validate
pnpm db:seed:408-source
pnpm db:check
```

`408-source:validate` 会校验源 ZIP SHA256、条目路径、JSON 契约、chunk/figure 关联、已提供 PNG/WebP 的 SHA256 和待人工复核图片门控。`db:seed:408-source` 是事务内幂等导入，只写以下四张独立表：

- `course_source_datasets`
- `course_source_chunks`
- `course_source_figure_assets`
- `course_source_figure_relations`

它不会删除或重写 `course_core_concepts`、`course_learning_modules` 或组成原理课程化数据。

## 管理员摘要接口

本地开发身份下：

```http
GET /api/v1/manage/courses/course_408_ds/source-layer
X-Dev-User-Id: user_admin_001
```

教师只能查看已分配课程，管理员可跨课程查看；学生返回 403。响应只包含书目、数量、复核状态和版权边界，不返回整本教材正文、`raw_metadata` 或图片二进制。

返回中的 `student_content_status=source_layer_only_curriculum_pending` 是刻意的诚实状态。下一批工作应按课程分别整理“章节 → 学习模块 → 核心知识点”，并在完成人工/授权复核后再开放学生阅读面。


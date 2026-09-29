# 组成原理课程内容接入说明

## 真实边界

- 课程域：408 四门课（数据结构、计算机组成原理、操作系统、计算机网络）。
- 首个已接讲解资料课程：计算机组成原理。
- 原始资料目录：`C:\Users\Administrator\Desktop\挑战杯\课程资料`，项目只保留本地副本，不移动或修改原文件。
- `knowledge.json` 504 条、`qa.json` 123 条已导入 PostgreSQL；`training.json` 123 组只登记为 `reference_only_not_model_training`，没有用于训练模型。
- 原始资料没有作者、版本、出版社和授权元数据，统一标记 `source_unknown_unverified / unverified / local_demo_only`。当前不得公开分发或宣称权威授权。
- 所有正文均以 `plain_text` 返回和渲染，不把源文本解释为 HTML。
- 当前未接真实 AI、RAG 或另一组工作流。课程问答 API 返回的是已存示例，不是实时模型回答。

## 可重复导入

```powershell
pnpm course-content:validate
pnpm db:setup
pnpm db:check
```

`db:setup` 顺序执行迁移、开发身份/课程种子、408 题库导入和组成原理内容导入。内容以稳定 `source_id / chunk_id / qa_id` 执行 upsert；重复运行不会增加重复记录。

## 学生 API

本地开发模式下以下接口需要请求头：

```http
X-Dev-User-Id: user_student_001
```

该请求头只是本地演示身份，不是学校 SSO 或生产认证。

### 课程总览

```http
GET /api/v1/408/courses
```

返回四门课程的真实题目数、材料状态、知识块数、问答数和章节数。只有组成原理当前为 `material_status=available`；其余三门明确返回 `pending`。

`recommended_start.basis=first_available_content` 只表示“首个可用内容”，不是 AI 诊断或个性化进度。

### 章节与知识块

```http
GET /api/v1/408/courses/computer-organization/chapters
GET /api/v1/408/courses/computer-organization/knowledge?chapter=1%20计算机系统概论&limit=1&offset=0
```

知识块保留原始 `chapter / page / source_item_id`，并固定返回 `content_format=plain_text`。

### 课程问答示例

```http
GET /api/v1/408/courses/computer-organization/qa-examples?limit=3&offset=0
```

原始 QA 没有章节与页码，因此 `chapter` 和 `page` 返回 `null`，调用方不得推测或补造。

### 课程训练

课程页跳转至现有真实题库链路：

```text
/student/practice?subject=组成原理
```

筛题、题目读取、选择题确定性判分与学习证据写入继续复用 `/api/v1/question-bank/*`。题目读取接口不返回答案；答案和解析只在提交评测后返回。

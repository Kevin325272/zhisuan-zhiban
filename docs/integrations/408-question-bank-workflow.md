# 408 题库与工作流对接说明

## 一、当前真实能力与边界

第一批底座使用 PostgreSQL 作为运行时事实源。`408_json_data(1).zip` 及解压 JSON 只参与离线导入；API 不在请求时读取 JSON。数据来源为 `csgraduates.com`，版权、转载和公开分发授权未核验，因此数据库记录固定携带：

```json
{
  "license_status": "unverified",
  "usage_scope": "local_demo_only",
  "source_url": "原题页面 URL"
}
```

当前提供本地账号与课程授权边界，但没有学校 SSO、真实学校花名册、真实 RAG、实时大模型评分或“用学生个人数据训练大模型”。`X-Dev-User-Id` 只在 `XUETU_AUTH_MODE=local_dev` 下生效，不能用于生产。

## 二、运行时数据模型

| 表 | 用途 | 关键边界 |
| --- | --- | --- |
| `users` / `roles` / `permissions` / `user_roles` | 用户与 RBAC | `student`、`teacher`、`admin` 分离；不存密码，不冒充认证系统 |
| `courses` / `course_memberships` | 课程与归属 | 教师只能管理已分配课程；管理员才有全局权限 |
| `materials` | 课程资料元数据 | 保留来源、存储引用、授权与审核状态 |
| `question_import_batches` / `questions` | 题库与导入批次 | 保留来源和授权状态；HTML 不入库；答案字段不由读题接口查询 |
| `practice_attempts` | 学生作答 | 记录选择项或主观文本；不将个人作答用于基础模型训练 |
| `evaluations` | 评测结果 | 选择题确定性；主观题 `pending_review` |
| `learning_evidence` | 可追溯学习证据 | 待复核证据不能更新掌握状态 |
| `question_learning_metadata` | 题源、允许模式和整卷保护 | 不保存答案；近三年真题仍由查询规则二次保护 |
| `student_question_memory_states` | 每位学生、每道题的 FSRS Card | 只由确定性客观题证据推进；幂等重放不重复推进 |
| `practice_exam_sessions` / `practice_exam_session_questions` | 服务端模考会话与冻结题目清单 | 保存公开题目快照，不在交卷前泄露答案 |

## 三、学生/工作流接口

### 1. 筛选题目

`GET /api/v1/question-bank/questions`

查询参数：

- `mode`：`targeted`、`past_exam` 或 `mistake_review`；`diagnostic` 使用首次设置接口，`mock_exam` 使用整卷会话接口；
- `subject`：科目，如 `数据结构`；
- `year`：年份；
- `type`：`choice` 或 `subjective`；
- `tags`：逗号分隔；
- `tag_match`：`all`（默认）或 `any`；
- `limit`：1—100，默认 20；
- `offset`：非负整数。

响应 `data`：

```json
{
  "items": [
    {
      "question": {
        "id": "2023-01",
        "year": 2023,
        "number": 1,
        "subject": "数据结构",
        "type": "choice",
        "multiple": false,
        "question": "纯文本题干",
        "options": [{ "option_id": "A", "text": "纯文本选项", "assets": [] }],
        "tags": ["线性表"],
        "assets": [],
        "content_format": "plain_text",
        "source": {
          "provider": "csgraduates.com",
          "dataset_id": "408_json_data",
          "source_url": "https://www.csgraduates.com/...",
          "license_status": "unverified",
          "usage_scope": "local_demo_only"
        }
      },
      "learning_metadata": {
        "source_type": "past_exam",
        "allowed_modes": ["targeted", "past_exam", "mock_exam"],
        "paper_year": 2023,
        "protect_full_paper": false,
        "importance": "core",
        "content_review_status": "pending_teacher_review"
      },
      "ranking": {
        "algorithm_version": "fsrs_v6_weighted_v1",
        "priority_score": 58,
        "evidence_level": "limited",
        "components": {
          "memory_risk": 0.35,
          "concept_weakness": 0,
          "repeated_error": 0,
          "importance": 1,
          "novelty": 1
        },
        "reason_lines": ["作答证据较少，当前按中性记忆风险参与排序。"]
      }
    }
  ],
  "total": 1,
  "limit": 20,
  "offset": 0
}
```

该接口不查询或返回 `answer_key`、解析、参考解答和网页 HTML。`ranking` 只在专项练习或错题复练返回；历年真题保持年份和原题号顺序，因此为 `null`。

### 2. 读取单题

`GET /api/v1/question-bank/questions/:questionId`

返回同一公开 `Question DTO`，仍不含答案。

### 3. 提交并评测

`POST /api/v1/question-bank/evaluations`

本地联调请求头：`X-Dev-User-Id: user_student_001`。服务会在评测前核验该用户处于启用状态、具有 `student` 角色，并以 `student` 成员身份加入当前课程；教师或未选课用户不能借开发身份头提交学生作答。

选择题请求：

```json
{
  "question_id": "2026-01",
  "answer_type": "choice",
  "selected_option_ids": ["A"]
}
```

综合题请求：

```json
{
  "question_id": "2026-41",
  "answer_type": "subjective",
  "response_text": "学生作答"
}
```

选择题提交后，响应才会包含 `correct_option_ids`、纯文本解析、`correct/incorrect`、0/100 分以及可写入学习状态的证据。综合题固定返回：

```json
{
  "grading_mode": "ai_or_teacher_review_required",
  "status": "pending_review",
  "is_correct": null,
  "score": null,
  "review_required": true
}
```

参考解答可以在提交后提供给复核工作流，但不能据此假称学生答案已自动判对。

## 四、教师/管理员接口边界

所有接口均要求本地开发身份或未来真实认证上下文：

- `GET /api/v1/manage/courses/:courseId/questions?review_status=`：题目来源与审核状态；不返回答案；
- `PATCH /api/v1/manage/questions/:questionId/review`：更新 `pending_review/approved/rejected`；
- `GET /api/v1/manage/courses/:courseId/materials`：课程资料清单；
- `POST /api/v1/manage/courses/:courseId/materials`：新增课程资料元数据；
- `GET /api/v1/manage/courses/:courseId/learning-summary`：仅聚合已存储的学生数、作答、确定性正确/错误、待复核和证据数量。

教师仅能访问 `course_memberships` 中以 `teacher` 成员身份分配给自己的课程；普通课程成员关系不能提升为教师权限。管理员可跨课程治理。第一版没有教师管理用户/角色的接口，避免把教师等同管理员。

## 五、错误码与状态

| HTTP | code | 含义 |
| --- | --- | --- |
| 400 | `QUESTION_BANK_FILTER_INVALID` | 筛选参数不符合契约 |
| 400 | `ANSWER_SUBMISSION_INVALID` | 作答结构无效 |
| 401 | `AUTHENTICATION_REQUIRED` / `ACTOR_NOT_FOUND` | 缺少本地身份或用户不可用 |
| 403 | `COURSE_ACCESS_DENIED` | 教师未被分配该课程或角色无权限 |
| 404 | `QUESTION_NOT_FOUND` / `COURSE_NOT_FOUND` | 资源不存在 |
| 422 | `ANSWER_TYPE_MISMATCH` / `DUPLICATE_SELECTED_OPTION` / `UNKNOWN_SELECTED_OPTION` | 作答与题型或选项不一致 |
| 503 | `AUTHENTICATION_NOT_CONFIGURED` / `IDENTITY_STORE_NOT_CONFIGURED` | 未启用本地身份、生产认证未接入或用户授权存储未注入 |

数据库连接、迁移或表缺失属于运行环境错误，由全局 500 处理；不能降级成 JSON 运行时数据库。

## 六、工作流组建议接点

1. 练题推荐只消费公开 Question DTO，不读取答案表字段。
2. 作答评测调用提交接口；选择题直接使用确定性结果。
3. 综合题工作流接收 `pending_review` 后，可产生独立的 AI/教师复核结果；在复核落库前不得更新掌握状态。
4. 学习编排只消费 `learning_evidence`，并检查 `eligible_for_learning_state_update`。
5. 图片第一批只保留可追溯引用。嵌入式 base64 仅记录 SHA-256 引用，不通过题目 API 传输；二进制资源服务尚未实现。

## 七、五种训练模式

| 模式 | 数据边界 | 顺序与反馈 |
| --- | --- | --- |
| 起步筛查 `diagnostic` | `408-v3` 八道项目自编题，每科两题，无伪造年份，待教师复核 | 固定顺序，只形成低置信度起步方向 |
| 专项练习 `targeted` | 排除筛查题和受保护的近三年整卷 | FSRS 个体复习权重排序，逐题确定性反馈 |
| 历年真题 `past_exam` | 只读可核验历年真题 | 严格按年份、原题号顺序，逐题反馈 |
| 全真模考 `mock_exam` | 同一年完整可用真题，由服务端冻结题目清单 | 固定 180 分钟，统一交卷后才返回评测 |
| 错题复练 `mistake_review` | 只读当前登录学生仍待复习的可核验错题 | FSRS 个体复习权重排序，逐题更新复习状态 |

67 份没有可核验答案的院校自命题 PDF 继续留在治理端，不进入学生训练模式。近三年保护以题库当前最大年份及前两年动态计算，浏览器不能解除。

## 八、开源 FSRS 与选题权重

项目固定依赖 `ts-fsrs@5.4.1`，许可证为 MIT。它只维护“某位学生对某道题”的记忆 Card，不负责题目难度、判分、权限或全局能力画像，也不作为平台自研创新点。

当前确定性映射为：

```text
incorrect      -> Rating.Again
correct        -> Rating.Good
pending_review -> 不推进 FSRS
```

专项练习与错题复练使用以下可审计公式，各分量均限制在 `[0, 1]`：

```text
priority = round(100 * (
  0.55 * memory_risk
  0.20 * concept_weakness
  0.10 * repeated_error
  0.10 * importance
  0.05 * novelty
))
```

没有 Card 时，`memory_risk` 使用中性值 `0.35`；知识点确定性作答少于 3 次或没有 Card 时返回 `evidence_level=limited`。页面只能说“有限证据”和“推荐权重”，不得写成精准难度、能力等级或已验证最优权重。

## 九、全真模考接口

- `POST /api/v1/question-bank/mock-exams`：传可选 `year`，创建或恢复当前学生的活动会话；未传年份时优先选择尚未完成的最新年份。响应同时返回 `server_now` 与 `expires_at`，浏览器据此校正本机时钟偏差。
- `POST /api/v1/question-bank/mock-exams/:sessionId/submit`：带 `Idempotency-Key` 一次提交去重后的作答数组。

浏览器按 `server_now -> expires_at` 的服务端时间轴倒计时，服务端仍在交卷时再次校验截止时间。活动会话到期后作答立即锁定；学生明确点击“重新开始本场”时，服务端复用原有冻结题面和题序，原子重置新的 180 分钟，不重新读取或换题。客观题按每题 2 分汇总；主观题只统计已提交和待审核数量；未答题单独计数。结果没有 150 分总分字段，在主观题审核前不得合成完整成绩。

## 十、可声明范围

可以声明：开源 FSRS v6 维护个体复习状态；五个训练模式有不同题源和反馈契约；权重与理由可审计；近三年整卷受保护；筛查题为项目自编；模考由服务端计时并统一交卷。

不能声明：已经训练出题目难度；该权重已由本校学生实证为最优；八道筛查题形成精准画像；模考自动给出完整 150 分成绩；全部题源已获得公开分发授权；这些功能已经提高考研成绩。

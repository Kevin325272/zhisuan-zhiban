# 智算智伴 AI Workflow 0.2 对接说明

## 1. 当前真实状态

智算智伴已经具备统一服务端 Gateway、PostgreSQL 上下文构建、学生权限校验和四个产品插槽。当前运行路径由服务端 OpenAI-compatible 适配器统一承接 `plan / explain / coach / diagnose`，人物画像也复用同一组 `LLM_*` 配置；切换为 `dify` 或项目原生 `/v1/ai-workflows/{capability}` 时才读取对应工作流配置。浏览器始终只调用智算智伴 API，不直连模型或外部工作流服务。

是否可用以 `/api/v1/student/ai-workflows/status` 和真实调用结果为准：未配置、超时、上游失败、上下文不足和引用不一致都会诚实降级；课程目录、教材阅读、课程案例、确定性选择题评测和学习证据写入不依赖 AI。

2026-08-21 的真实中转抽样确认 `/v1/models` 与 `/v1/responses` 可达，抽样响应报告了配置的模型 ID。该结果只证明本次调用，不能证明中转未来不会做模型替换；因此每次 OpenAI-compatible 工作流响应都会保留 `requested_model / provider_model / matched / latency_ms` 审计字段，运行状态也按能力独立记录。

提供方给出可访问 endpoint 与服务端凭据后，只需配置服务端环境变量并重启 API；页面不需要改成直连。OpenAI-compatible 路径记录上游响应自报模型，但该字段仍是提供方声明，不等同于对底层实际模型权重的独立证明。Dify `/workflows/run` 不暴露实际模型时，只能由提供方后台或交接材料确认。

## 2. 责任边界

### 智算智伴负责

- 校验本地学生身份、角色和课程成员关系；
- 从真实 PostgreSQL 构建最小上下文；
- 选择需要发送的课程、知识点、来源切片、阅读进度、作答、评测和学习证据；
- 调用统一 Workflow Gateway，并校验响应 schema、引用归属和证据归属；
- 将安全字段返回浏览器；
- 对任何拟写入的学习证据再次验证并由我方代码执行。

### 工作流组负责

- 按双方确认的 capability 实现对应工作流；当前 OpenAI-compatible 路径统一承接四项能力，切换 provider 后仍须遵守同一契约；
- 仅根据本次请求内的课程上下文工作，不自行读取我方数据库；
- 返回结构化展示块、课程引用、已给证据引用和可执行的下一步动作；
- 遵守超时、幂等和错误协议；
- 不直接写我方学习记录，不把推断包装成已经发生的学生事实。

### 明确边界

- 配置 OpenAI-compatible 中转只代表调用协议可用，不代表模型开源、自研、已完成垂类训练或已接入在线 RAG；
- 当前本地演示模型为闭源临时模型，赛题材料中不得将其表述为开源模型；后续更换模型时无需改变浏览器接口；
- 本地 mock 只做契约校验，不代表 AI 质量或能力已完成；
- 学生数据不用于“训练大模型”；本批只在单次请求中按最小必要原则提供学习上下文。

## 3. 端点与传输协议

工作流组如果提供自有 HTTP 服务，需要提供：

| capability | HTTP endpoint | 学生流程位置 |
| --- | --- | --- |
| `plan` | `POST /v1/ai-workflows/plan` | 首页 / 课程入口的下一步任务 |
| `explain` | `POST /v1/ai-workflows/explain` | 组成原理知识点讲解 |
| `coach` | `POST /v1/ai-workflows/coach` | 真实课程 QA / 案例分步辅导 |
| `diagnose` | `POST /v1/ai-workflows/diagnose` | 四门408课程真实选择题结果 |

每个请求必须支持：

```http
Authorization: Bearer <server-only-secret>
Content-Type: application/json
Accept: application/json
Idempotency-Key: <request_id>
X-Xuetu-Contract-Version: 0.2
```

- 凭据只配置在智算智伴 API 服务端，禁止发送到浏览器、日志或截图。
- `Idempotency-Key` 与 body 的 `request_id` 相同；同一 key 的重试应返回语义一致的结果。
- OpenAI-compatible 路径使用 `LLM_TIMEOUT_MS`，默认等待上限为 **30 秒**；Dify 与项目原生 Workflow 0.2 适配器仍使用 20 秒上限。提供方应更早终止下游调用并返回结构化失败。
- 正式/远程地址必须使用 HTTPS；本地联调允许 `http://127.0.0.1` 或 `http://localhost`。

服务端配置：

```dotenv
AI_WORKFLOW_BASE_URL=
AI_WORKFLOW_SECRET=
```

使用 Dify 原生工作流时，配置形态为（真实 secret 只放被 `.gitignore` 忽略的服务端 `.env.local`，不要复制到此文件或前端）：

```dotenv
AI_WORKFLOW_PROVIDER=dify
AI_WORKFLOW_BASE_URL=https://<workflow-host>/v1/workflows/run
AI_WORKFLOW_SECRET=<server-only-dify-app-key>
```

`AI_WORKFLOW_BASE_URL` 在 `dify` 模式下就是完整的 `/v1/workflows/run` 地址，适配器不会再拼接四个自有端点。远程地址必须是 HTTPS；临时 ngrok/隧道地址依赖对方电脑在线，地址变化后需重新配置并重启 API。

使用自有 OpenAI-compatible 中转时，工作流 Gateway 复用同一组仅服务端可见的 `LLM_*` 配置：

```dotenv
AI_WORKFLOW_PROVIDER=openai_compatible
LLM_BASE_URL=https://<relay-host>/v1
LLM_API_KEY=<server-only-key>
LLM_MODEL=<configured-model-id>
```

该模式调用 `${LLM_BASE_URL}/responses`，再将模型 JSON 输出收敛到 Workflow 0.2 契约。发送给模型的上下文会移除标准答案、评测内部 ID、来源 locator 和账户隐私字段；返回结果继续执行“本次实际发送集合”的引用白名单、动作 target 白名单和答案泄露检查。在 `openai_compatible` 模式下，`LLM_*` 同时承接四项能力与人物画像；`AI_WORKFLOW_BASE_URL/SECRET` 和 `AI_PROFILE_WORKFLOW_BASE_URL/SECRET` 不作为 override，应保持为空，避免遗留凭据长期滞留。

仅在非 `openai_compatible` 模式下启用 Dify 人物画像时，使用独立服务端配置：

```dotenv
AI_PROFILE_WORKFLOW_BASE_URL=https://<workflow-host>/v1/workflows/run
AI_PROFILE_WORKFLOW_SECRET=<server-only-profile-key>
```

两个值同时为空表示未连接；只配置其中一个会被视为配置错误。真实 secret 不得提交到仓库；凭据一旦出现在聊天、截图或日志中必须轮换，不能只从本地文件删除。

学生端通过以下只读接口获取运行状态，浮动入口不得自行猜测连接情况：

```http
GET /api/v1/student/ai-workflows/status?capability=diagnose
X-Dev-User-Id: <local-demo-student-only>

GET /api/v1/student/profile/ai/status
X-Dev-User-Id: <local-demo-student-only>
```

| `state` | 学生端语义 |
| --- | --- |
| `not_configured` | AI 服务待连接 |
| `configured` | 服务端配置已存在，但尚未通过一次受契约约束的成功调用 |
| `available` | 最近一次受契约约束的调用成功 |
| `degraded` | 最近一次调用仅返回有限结果 |
| `unavailable` | 最近一次调用失败或上游暂不可用 |

状态按 `plan / explain / coach / diagnose` 分开记录，人物画像另行记录；一次 diagnose 成功不会把 plan 或画像标成可用。`/api/v1/system-status` 聚合所有命名能力，只要任一能力或画像经过真实成功调用才显示通用 agent 为 `live`。外部调用观测 5 分钟后过期并回到 `configured`。PostgreSQL 上下文不足或本地资料外发策略阻断不会污染服务健康。接口不返回 base URL、secret、模型内部提示或教材内容。

### 调用成本与故障保护

- 首页折叠说明默认不调用 AI，学生点击“生成 AI 说明”后才发送最小上下文；
- 浏览器对完全相同的在途 invocation 做单飞去重，React 开发模式不会造成双请求；
- OpenAI-compatible 四能力与画像共用上游熔断器，连续两次 429、5xx、网络错误或超时后冷却 30 秒；
- 生成请求不做自动重试，避免超时后重复计费；用户可在当前结果失败后显式重试；
- 四能力与画像使用独立的每用户并发通道，画像生成不会占住课程解释或诊断名额。

## 4. 内部上下文与最小外发 DTO

共享 schema 的唯一事实来源：

- `packages/contracts/src/index.ts`
- `aiWorkflowRequestSchema`
- `AiWorkflowRequest`

`AiWorkflowRequest` 是智算智伴服务端内部上下文，不得整包发送给外部工作流。下面示例只说明服务端能够关联的数据；Gateway 会在 provider 边界重新构建最小 DTO，并移除真实 user id、attempt/question/evaluation 内部 ID、`correct_option_ids`、判题说明和来源 locator。

示例（`explain`）：

```json
{
  "contract_version": "0.2",
  "request_id": "workflow_req_001",
  "capability": "explain",
  "slot": "contextual_explanation",
  "user_id": "user_student_001",
  "course_id": "course_408_co",
  "concept_id": "co_c01_01",
  "source_chunk_ids": ["co_k_1"],
  "attempt_id": null,
  "learning_evidence": [
    {
      "evidence_id": "reading_user_student_001_course_408_co",
      "kind": "reading_progress",
      "summary": "已阅读当前来源的前两段。",
      "observed_at": "2026-07-28T09:00:00.000Z"
    }
  ],
  "user_message": null,
  "context": {
    "student": {
      "user_id": "user_student_001"
    },
    "course": {
      "course_id": "course_408_co",
      "title": "计算机组成原理",
      "discipline": "计算机科学与技术"
    },
    "concept": {
      "concept_id": "co_c01_01",
      "title": "硬件、软件与计算机系统",
      "learning_objective": "区分硬件与软件，并说明二者如何共同构成计算机系统。",
      "key_terms": ["硬件", "软件", "计算机系统"]
    },
    "source_chunks": [
      {
        "source_chunk_id": "co_k_1",
        "chapter": "1 计算机系统概论",
        "locator": "课程资料定位",
        "content": "本次讲解需要的最小来源内容。"
      }
    ],
    "reading_progress": {
      "chunk_id": "co_k_1",
      "paragraph_index": 1,
      "source_expanded": false,
      "updated_at": "2026-07-28T09:00:00.000Z"
    },
    "qa_case": null,
    "attempt": null,
    "evaluation": null
  }
}
```

### 四类能力的上下文要求

| capability | 必需上下文 | 可选上下文 |
| --- | --- | --- |
| `plan` | student、course | reading progress、recent evaluation、learning evidence |
| `explain` | student、course、concept、至少一个 source chunk | reading progress、user message、learning evidence |
| `coach` | student、course、concept、source chunk、真实 qa case | reading progress、user message、learning evidence |
| `diagnose` | student、course、真实 attempt、确定性 evaluation | concept（若提供则带来源块）、learning evidence、user message |

补充约束：

- `source_chunk_ids` 必须与 `context.source_chunks` 顺序和内容一致；
- `user_id / course_id / concept_id / attempt_id` 必须与嵌套上下文一致；
- `coach` 只发送本次导入课程示例所需内容；`diagnose` 的标准答案与正确选项不离开确定性判分服务，也不返回浏览器；
- 内部请求最多关联 6 个来源切片；OpenAI-compatible 边界实际只发送前 3 个，引用与动作只能使用这 3 个片段的 ID。学习证据最多 50 条，不得要求发送教材全库；
- 上下文不足由智算智伴在调用前返回 `insufficient_context`，不会补造数据。
- 当前教材及导入课程资料均为 `local_demo_only / license unverified`，默认禁止外发。远程实时联调只能使用合成来源，除非资料使用边界另行确认并由服务端显式开启。

## 5. 统一响应 DTO

共享事实来源为 `aiWorkflowResponseSchema` / `AiWorkflowResponse`。

```json
{
  "contract_version": "0.2",
  "request_id": "workflow_req_001",
  "capability": "explain",
  "slot": "contextual_explanation",
  "status": "ready",
  "display_blocks": [
    {
      "block_id": "block_001",
      "kind": "summary",
      "title": "理解要点",
      "content": "面向学生展示的受来源约束内容。"
    }
  ],
  "citations": [
    {
      "citation_id": "citation_001",
      "source_chunk_id": "co_k_1",
      "label": "计算机系统概论",
      "locator": "课程资料定位"
    }
  ],
  "evidence_refs": [
    {
      "evidence_id": "reading_user_student_001_course_408_co",
      "label": "本次阅读位置",
      "summary": "已阅读当前来源的前两段。"
    }
  ],
  "next_actions": [
    {
      "action_id": "continue_001",
      "kind": "continue_learning",
      "label": "继续阅读本节",
      "target": "#lesson-source-original"
    }
  ],
  "model_trace": {
    "requested_model": "configured-model-id",
    "provider_model": "provider-reported-model-id",
    "matched": true,
    "latency_ms": 5100
  },
  "failure": null
}
```

### 5.1 工作流组 diagnose 的 Dify 转换

Dify 原生响应外层为：

```json
{
  "data": {
    "outputs": {
      "status": "ready",
      "error_analysis": "...",
      "step_by_step_hints": ["..."],
      "knowledge_references": [
        {"source_chunk_id":"synthetic_chunk_001","title":"合成来源"}
      ],
      "next_actions": ["继续复习"]
    }
  }
}
```

新版诊断契约直接读取 `response.data.data.outputs` 对象，不要求工作流回显 request id；请求侧自行关联。为兼容当前线上旧 App，若新版结构不存在，服务端可解析一次 `outputs.answer` JSON 字符串，但它必须通过旧版 Workflow 0.2 schema、请求关联、引用白名单、动作白名单和答案泄露检查。自由文本、双重编码、越界引用或字段不完整仍失败关闭。浏览器不读取 `outputs.answer`，上游 workflow/task id、headers、原始 prompt 和其他字段也不会透传浏览器。`knowledge_references` 只能选择本次 `knowledge_reference_inputs` 中的 `source_chunk_id`；未知引用、空引用、标准答案泄露或短正确选项文本泄露都会整次失败关闭。

Dify 输入由服务端构建为：

```json
{
  "inputs": {
    "capability": "diagnose",
    "user_text": "由本次合成题面、学生作答和确定性结果构成的最小诊断请求，不含答案键",
    "textbook_snippets": "[片段ID: synthetic_chunk_001] 仅本次允许引用的合成来源",
    "student_profile": "不含身份字段的最小画像摘要",
    "course": "合成课程",
    "knowledge_points": "合成知识点",
    "task_content": "合成题目与选项",
    "learner_response": "学生选择的选项",
    "deterministic_assessment": "平台已判定错误，不含答案键",
    "learning_evidence_bundle": "最小合成学习证据",
    "backend_diagnosis_basis": "服务端确定性诊断边界",
    "knowledge_reference_inputs": "仅本次允许引用的合成来源",
    "student_profile_summary": "不含身份字段的最小画像摘要",
    "response_language": "zh-CN",
    "request_id": "workflow_req_001"
  },
  "response_mode": "blocking",
  "user": "xuetu-ai-workflow"
}
```

`capability / user_text / textbook_snippets / student_profile` 仅用于兼容当前线上 Dify App 的旧输入表单；它们由同一份最小上下文生成，不扩大数据范围。工作流组移除旧表单依赖后可以删除这些兼容字段。发送给 `diagnose` 的输入不包含真实学生 ID、`correct_option_ids`、评测内部 ID 或标准答案字段；服务端确定性评测仍是事实来源。Dify 的 `user` 是固定匿名调用标识，不用于平台账户归属。

### 响应校验

- `request_id / capability / slot` 必须与请求一致；
- `citations[].source_chunk_id` 只能来自本次实际发送给提供方的来源集合，不能仅因为 ID 存在于服务端完整请求中就放行；
- `evidence_refs[].evidence_id` 只能来自本次 `learning_evidence`；
- 工作流可以建议 evidence candidate，但不能声称已经写库，也不能直接写库；
- `display_blocks` 只允许 `summary / hint / question / feedback / notice`；
- `next_actions` 只允许契约列出的产品动作，不能返回不存在的能力或管理端地址；
- `ready + diagnose` 必须同时包含 `feedback`（错因或结果解释）、`hint`（分步提示）、至少一个本次请求来源引用和至少一个下一步动作；
- 非 `ready/degraded` 状态不得用 display block 伪装成功结果。
- 引用 ID 白名单只证明“模型被允许看到该片段”，不能自动证明片段语义足以支持生成结论；关键学习结论仍需做人工抽样与语义一致性评估。

## 6. 人物画像候选契约

人物画像工作流不拥有生成学生事实的权限。智算智伴先从 PostgreSQL 的阅读、确定性选择题、错题和课程自评生成三类候选：`strength_candidates`、`priority_gap_candidates`、`allowed_next_tasks`。每个候选都带稳定 `candidate_id` 和服务端证据 ID；工作流只能选择候选，不能提交标题、解释、任务内容、分数或新证据。

工作流输出必须是 `data.outputs` 对象：

```json
{
  "status": "ready",
  "strengths": [{"candidate_id":"strength_course_408_co_knowledge_coverage"}],
  "priority_gaps": [{"candidate_id":"gap_course_408_co_mistake_recovery_co_c01_01"}],
  "next_tasks": [{"candidate_id":"task_course_408_co_review_mistakes_co_c01_01"}]
}
```

- 三个数组元素只允许 `candidate_id`，任何 `title / detail / reason / course_id / evidence_ids` 等附加字段都会被拒绝；
- 工作流可同时返回 `profile_summary / learning_goal / course_progress / evidence_summary` 等约定的说明字段；Gateway 会忽略这些字段，学生端仍只展示服务端候选回填的内容；
- 未知 ID、重复 ID、无证据候选、越权证据或全空选择都会返回 `failed + WORKFLOW_FAILED`；
- 学生端最终标题、解释、任务和 `profile_summary` 全部由服务端候选回填，不直接展示模型自造结论；
- Dify `user` 固定为 `xuetu-profile-workflow`，不发送真实学生 ID；
- 工作流不能写画像分数、学习记录或下一次复习日期。
- `profile_summary / course_progress / strengths / priority_gaps / next_tasks` 富对象不能直接上屏，也不能通过标题或课程名猜测匹配；当前工作流必须返回上面的 `candidate_id` 选择数组，说明字段仅作兼容扩展。

## 7. 失败、降级与 HTTP 状态

业务响应状态：

| status | 含义 |
| --- | --- |
| `ready` | 结果完整可展示，`failure=null` |
| `degraded` | 有限结果可展示，可附降级说明 |
| `unavailable` | 服务未配置或暂时不可用 |
| `failed` | 请求已到达但工作流处理失败 |
| `insufficient_context` | 智算智伴无法从真实数据库构建足够上下文 |

失败码：

- `WORKFLOW_NOT_CONNECTED`
- `CONTEXT_INCOMPLETE`
- `UPSTREAM_UNAVAILABLE`
- `WORKFLOW_TIMEOUT`
- `WORKFLOW_FAILED`

Gateway 映射：

| 情况 | 智算智伴结果 |
| --- | --- |
| 未配置 base URL / secret | `unavailable + WORKFLOW_NOT_CONNECTED` |
| 超过 20 秒 | `failed + WORKFLOW_TIMEOUT` |
| 工作流 HTTP 429 / 5xx | `unavailable + UPSTREAM_UNAVAILABLE` |
| 非 JSON、schema 错误、引用越界 | `failed + WORKFLOW_FAILED` |
| PostgreSQL 上下文缺失 | `insufficient_context + CONTEXT_INCOMPLETE`，不调用上游 |

任何失败下，现有课程阅读、真实案例、选择题解析和下一题按钮继续可用。

## 8. 安全与数据规则

- 浏览器只提交最小 invocation：course/concept/QA/attempt 标识和可选学生问题，不提交 user id、标准答案、教材全文或学习证据；
- user id 从本地/未来生产认证解析，课程权限由服务端再次校验；
- Gateway 响应只返回共享安全 DTO，不透传上游任意字段；
- secret、内部提示、上游原始日志和其他学生记录不得进入响应；
- 工作流不拥有数据库写权限。本批所有上下文查询均为只读；
- 学习证据只用于当前学习状态与个性化服务，不表述为“拿个人数据训练大模型”。
- 旧 `/learning-sessions` 与 `/agent-runs` BFS 内存态问答默认不注册；只有显式本地兼容开关可启用，学生正式导航和 `/student/ask` 不再把它包装成通用 AI。

## 9. 本地 mock 与 conformance

以下 mock/conformance 只验证本项目原生 `provider=xuetu` 的四端点协议，不可直接套到 Dify `/workflows/run`。安装依赖并在终端 A 启动契约 mock：

```powershell
pnpm --filter @xuetu/api workflow:mock
```

默认地址为 `http://127.0.0.1:4310`，默认本地测试 secret 为 `contract-mock-secret`。该服务固定返回“契约联调固定响应”，**不能用于产品能力演示**。

终端 B 运行四能力 conformance：

```powershell
$env:AI_WORKFLOW_BASE_URL='http://127.0.0.1:4310'
$env:AI_WORKFLOW_SECRET='contract-mock-secret'
pnpm --filter @xuetu/api workflow:conformance
```

成功标准：

- `plan / explain / coach / diagnose` 四项均为 `ok: true`；
- Authorization、contract version 和 Idempotency-Key 均被服务端接受；
- 响应通过 0.2 schema；
- citations/evidence refs 均属于本次请求。

自动测试：

```powershell
pnpm --filter @xuetu/api exec vitest run tests/ai-workflow-conformance.test.ts
pnpm --filter @xuetu/api exec vitest run tests/dify-ai-workflow-gateway.test.ts tests/profile-workflow-gateway.test.ts
```

Dify 实时联调只使用合成课程、合成题目、合成来源和匿名调用标识。实时输出只记录状态、失败码、引用归属和展示块类型，不保存模型原文、secret 或真实学生信息。

当前合成联调结论：诊断在旧输入和旧外壳兼容后可得到 `ready`，且引用归属、展示块和下一步动作均通过校验；人物画像 endpoint 可达但响应尚未通过候选契约，只能保持 `failed + WORKFLOW_FAILED` 降级。工作流组修正人物画像输出后，应重新运行同一候选归属测试，不能通过放宽服务端校验来换取“可用”状态。

## 10. 工作流组交付清单

1. 每个已交付 capability 的可访问 endpoint；
2. diagnose 与人物画像各自的服务端 Bearer secret 安全交付方式；
3. diagnose 通过 Dify 专用 inputs/outputs 测试，人物画像通过 candidate_id 契约测试；
4. 真实模型与检索组件说明，明确哪些能力不是同一模型改名；
5. 超时、限流、幂等缓存和错误码实现说明；
6. 引用如何绑定输入 `source_chunk_id`；
7. 对学生隐私、日志留存和数据删除的说明。

接通时只修改服务端配置、运行对应 provider 的契约与合成联调、重启 API 并验收对应学生场景；页面不直连外部服务，也不复制多套适配逻辑。

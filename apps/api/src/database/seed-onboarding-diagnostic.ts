import { createHash } from "node:crypto";

import {
  questionDtoSchema,
  questionLearningMetadataSchema,
} from "@xuetu/contracts";

import { withTransaction, type SqlQueryablePool } from "./client.js";

export const LEGACY_ONBOARDING_DIAGNOSTIC_SET_VERSIONS = ["408-v1", "408-v2"] as const;
export const ONBOARDING_DIAGNOSTIC_SET_VERSION = "408-v3" as const;

interface OnboardingDiagnosticOptionDefinition {
  optionId: string;
  text: string;
}

export interface OnboardingDiagnosticQuestionDefinition {
  ordinal: number;
  questionId: string;
  courseId: "course_408_ds" | "course_408_co" | "course_408_os" | "course_408_cn";
  subject: string;
  conceptId: string;
  conceptTitle: string;
  questionText: string;
  options: readonly OnboardingDiagnosticOptionDefinition[];
  correctOptionIds: readonly string[];
  explanation: string;
  tags: readonly string[];
}

const option = (optionId: string, text: string): OnboardingDiagnosticOptionDefinition => ({
  optionId,
  text,
});

export const ONBOARDING_DIAGNOSTIC_QUESTIONS: readonly OnboardingDiagnosticQuestionDefinition[] = [
  {
    ordinal: 1,
    questionId: "screening-408-v3-01",
    courseId: "course_408_ds",
    subject: "数据结构",
    conceptId: "ds_c03_01",
    conceptTitle: "栈的抽象与存储",
    questionText: "关于栈的抽象特征，下列说法正确的是哪一项？",
    options: [
      option("A", "元素只能在栈顶一端插入和删除"),
      option("B", "所有元素必须存放在一段连续内存中"),
      option("C", "可以按下标在任意位置访问元素"),
      option("D", "出栈顺序必须与入栈顺序相同"),
    ],
    correctOptionIds: ["A"],
    explanation: "栈的核心约束是后进先出，入栈和出栈都发生在栈顶；顺序栈和链栈都可以实现这一抽象。",
    tags: ["栈的抽象与存储", "栈", "后进先出"],
  },
  {
    ordinal: 2,
    questionId: "screening-408-v3-02",
    courseId: "course_408_ds",
    subject: "数据结构",
    conceptId: "ds_c08_03",
    conceptTitle: "冒泡与快速排序",
    questionText: "对包含 n 个互不相同元素、已经升序的序列做升序排序。冒泡排序采用“一趟无交换则停止”的优化，快速排序固定选择首元素为枢轴并进行二路划分。下列判断正确的是哪一项？",
    options: [
      option("A", "两种算法都一定需要 O(n log n) 时间"),
      option("B", "冒泡排序可在一趟后停止，快速排序可能退化到 O(n^2)"),
      option("C", "冒泡排序一定退化到 O(n^2)，快速排序一定为 O(n)"),
      option("D", "两种算法都必须进行大量元素交换"),
    ],
    correctOptionIds: ["B"],
    explanation: "有序序列会让带提前终止标志的冒泡排序一趟结束；固定首元素为枢轴会让快速排序产生极不平衡的划分。",
    tags: ["冒泡与快速排序", "冒泡排序", "快速排序"],
  },
  {
    ordinal: 3,
    questionId: "screening-408-v3-03",
    courseId: "course_408_co",
    subject: "组成原理",
    conceptId: "co_c06_03",
    conceptTitle: "补码加减与溢出判断",
    questionText: "在 8 位二进制补码中计算 01111111 + 00000001，结果和溢出情况分别是什么？",
    options: [
      option("A", "00000000，未溢出"),
      option("B", "10000000，发生溢出"),
      option("C", "10000000，未溢出"),
      option("D", "01111111，发生溢出"),
    ],
    correctOptionIds: ["B"],
    explanation: "两个正数相加得到符号位为 1 的结果，超出 8 位补码可表示的正数范围，因此发生溢出。",
    tags: ["补码加减与溢出判断", "补码", "溢出"],
  },
  {
    ordinal: 4,
    questionId: "screening-408-v3-04",
    courseId: "course_408_co",
    subject: "组成原理",
    conceptId: "co_c07_01",
    conceptTitle: "机器指令与指令格式",
    questionText: "一条指令长度为 16 位，其中操作码占 6 位，其余部分由两个等长地址码字段组成。每个地址码字段占多少位？",
    options: [
      option("A", "4 位"),
      option("B", "5 位"),
      option("C", "6 位"),
      option("D", "10 位"),
    ],
    correctOptionIds: ["B"],
    explanation: "两个地址码字段共占 16 - 6 = 10 位，等长划分后每个字段占 5 位。",
    tags: ["机器指令与指令格式", "操作码", "地址码"],
  },
  {
    ordinal: 5,
    questionId: "screening-408-v3-05",
    courseId: "course_408_os",
    subject: "操作系统",
    conceptId: "os_c05_03",
    conceptTitle: "页面置换算法",
    questionText: "某进程有 3 个空页框，采用 FIFO 页面置换算法访问页面序列 1、2、3、1、4。访问页面 4 时应淘汰哪个页面？",
    options: [
      option("A", "页面 1"),
      option("B", "页面 2"),
      option("C", "页面 3"),
      option("D", "不淘汰页面"),
    ],
    correctOptionIds: ["A"],
    explanation: "FIFO 按页面最早进入内存的时间淘汰；再次访问页面 1 不会改变其进入顺序，所以页面 1 最先被换出。",
    tags: ["页面置换算法", "FIFO", "缺页"],
  },
  {
    ordinal: 6,
    questionId: "screening-408-v3-06",
    courseId: "course_408_os",
    subject: "操作系统",
    conceptId: "os_c03_04",
    conceptTitle: "安全状态与银行家算法",
    questionText: "系统有两类资源，当前可用资源 Available = (1,0)。P1 已分配资源 Allocation = (0,1)，尚需资源 Need = (1,0)；P2 已分配资源 Allocation = (1,0)，尚需资源 Need = (1,1)。按银行家算法判断，下列哪一个是安全序列？",
    options: [
      option("A", "P1 → P2"),
      option("B", "P2 → P1"),
      option("C", "P1、P2 都不能先执行"),
      option("D", "不存在安全序列"),
    ],
    correctOptionIds: ["A"],
    explanation: "令 Work = Available = (1,0)。P1 的 Need 不超过 Work，模拟其完成后，Work 加上 P1 原先的 Allocation，得到 (1,1)；此时可满足 P2 的 Need，P2 完成后 Work = (2,1)。因此安全序列为 P1 → P2。注意 Allocation 表示当前已分配资源，不是包含后续申请量的全部释放资源。",
    tags: ["安全状态与银行家算法", "安全序列", "银行家算法"],
  },
  {
    ordinal: 7,
    questionId: "screening-408-v3-07",
    courseId: "course_408_cn",
    subject: "计算机网络",
    conceptId: "cn_c06_01",
    conceptTitle: "DNS 层次命名与解析",
    questionText: "本地域名服务器无相关缓存，已知根服务器地址，且不使用转发。www.example.com 在 example.com 区域内有直接地址记录（非别名）。采用迭代查询时，通常依次询问哪几类服务器？",
    options: [
      option("A", "example.com 权威服务器 → 根服务器 → .com 顶级域服务器"),
      option("B", ".com 顶级域服务器 → 根服务器 → example.com 权威服务器"),
      option("C", "根服务器 → .com 顶级域服务器 → example.com 权威服务器"),
      option("D", "只询问根服务器即可得到最终主机地址"),
    ],
    correctOptionIds: ["C"],
    explanation: "迭代解析沿 DNS 层次逐级获得转介：先询问根服务器，再询问 .com 顶级域服务器，最后询问目标域的权威服务器。",
    tags: ["DNS 层次命名与解析", "DNS", "迭代查询"],
  },
  {
    ordinal: 8,
    questionId: "screening-408-v3-08",
    courseId: "course_408_cn",
    subject: "计算机网络",
    conceptId: "cn_c05_02",
    conceptTitle: "UDP 与 TCP 的服务差异",
    questionText: "某应用要求数据可靠、按序到达，并希望由运输层提供字节流服务。应优先选择哪个协议？",
    options: [
      option("A", "UDP，因为 UDP 自动保证可靠和按序交付"),
      option("B", "TCP，因为 TCP 提供面向连接的可靠字节流"),
      option("C", "UDP，因为 UDP 会自动重传丢失报文"),
      option("D", "两者完全等价，可任意选择"),
    ],
    correctOptionIds: ["B"],
    explanation: "TCP 提供面向连接、可靠且按序的字节流服务；UDP 不在运输层保证可靠交付、重传或顺序。",
    tags: ["UDP 与 TCP 的服务差异", "TCP", "UDP"],
  },
];

export const SELF_AUTHORED_PRACTICE_QUESTIONS: readonly OnboardingDiagnosticQuestionDefinition[] = [
  {
    ordinal: 1,
    questionId: "practice-408-v1-01",
    courseId: "course_408_ds",
    subject: "数据结构",
    conceptId: "ds_c03_02",
    conceptTitle: "队列与循环队列",
    questionText: "长度为 8 的数组实现循环队列，front 指向队头元素，rear 指向下一个入队位置，并牺牲一个存储单元区分队空和队满。该队列最多能存放多少个元素？",
    options: [
      option("A", "6 个"),
      option("B", "7 个"),
      option("C", "8 个"),
      option("D", "9 个"),
    ],
    correctOptionIds: ["B"],
    explanation: "牺牲一个存储单元时，队满条件为 (rear + 1) mod 8 = front，因此有效容量为 8 - 1 = 7。",
    tags: ["队列与循环队列", "循环队列", "队满条件"],
  },
  {
    ordinal: 2,
    questionId: "practice-408-v1-02",
    courseId: "course_408_ds",
    subject: "数据结构",
    conceptId: "ds_c06_03",
    conceptTitle: "广度优先搜索与连通分量",
    questionText: "无向图的顶点集为 {1,2,3,4,5,6}，边集为 {(1,2),(2,3),(4,5)}。对每个尚未访问的顶点启动一次 BFS，共会得到多少个连通分量？",
    options: [
      option("A", "1 个"),
      option("B", "2 个"),
      option("C", "3 个"),
      option("D", "4 个"),
    ],
    correctOptionIds: ["C"],
    explanation: "顶点 {1,2,3}、{4,5} 和孤立顶点 {6} 分别构成一个连通分量，因此需要启动三次 BFS。",
    tags: ["广度优先搜索与连通分量", "BFS", "连通分量"],
  },
  {
    ordinal: 3,
    questionId: "practice-408-v1-03",
    courseId: "course_408_co",
    subject: "组成原理",
    conceptId: "co_c04_01",
    conceptTitle: "存储体系的层次结构",
    questionText: "从 CPU 寄存器到辅助存储器，关于典型存储层次变化趋势的描述，正确的是哪一项？",
    options: [
      option("A", "速度逐渐降低、容量通常增大、单位成本通常降低"),
      option("B", "速度逐渐提高、容量通常减小、单位成本通常降低"),
      option("C", "速度和容量都逐渐提高、单位成本保持不变"),
      option("D", "各层速度、容量和单位成本没有稳定差异"),
    ],
    correctOptionIds: ["A"],
    explanation: "存储层次用少量高速高成本存储器配合大量低速低成本存储器，越远离 CPU，速度通常越低、容量越大、单位成本越低。",
    tags: ["存储体系的层次结构", "存储层次", "局部性"],
  },
  {
    ordinal: 4,
    questionId: "practice-408-v1-04",
    courseId: "course_408_co",
    subject: "组成原理",
    conceptId: "co_c04_04",
    conceptTitle: "Cache 与程序局部性",
    questionText: "在 C 语言按行优先存放二维数组 int a[100][100] 的前提下，下列遍历方式通常更有利于利用 Cache 的空间局部性的是哪一项？",
    options: [
      option("A", "外层遍历列 j，内层遍历行 i，访问 a[i][j]"),
      option("B", "外层遍历行 i，内层遍历列 j，访问 a[i][j]"),
      option("C", "每次随机选择 i 和 j 访问 a[i][j]"),
      option("D", "四种访问方式对 Cache 命中率没有影响"),
    ],
    correctOptionIds: ["B"],
    explanation: "按行优先存放时，同一行相邻列元素在内存中连续；让 j 在内层递增可连续访问相邻地址，更好利用空间局部性。",
    tags: ["Cache 与程序局部性", "Cache", "空间局部性"],
  },
  {
    ordinal: 5,
    questionId: "practice-408-v1-05",
    courseId: "course_408_os",
    subject: "操作系统",
    conceptId: "os_c02_04",
    conceptTitle: "临界区与信号量同步",
    questionText: "互斥信号量 mutex 的初值为 1。进程 P 执行 wait(mutex) 后进入临界区，此时进程 Q 也执行 wait(mutex)。在 P 执行 signal(mutex) 前，Q 的状态最可能是什么？",
    options: [
      option("A", "继续进入同一临界区"),
      option("B", "因等待 mutex 而阻塞"),
      option("C", "立即终止"),
      option("D", "绕过临界区继续执行"),
    ],
    correctOptionIds: ["B"],
    explanation: "P 获得互斥信号量后 mutex 不再可用，Q 的 wait 操作会使其等待；直到 P 执行 signal 释放信号量后，Q 才可能继续。",
    tags: ["临界区与信号量同步", "信号量", "互斥"],
  },
  {
    ordinal: 6,
    questionId: "practice-408-v1-06",
    courseId: "course_408_os",
    subject: "操作系统",
    conceptId: "os_c05_03",
    conceptTitle: "页面置换算法",
    questionText: "某进程有 3 个空页框，采用 LRU 页面置换算法依次访问页面 1、2、3、1、4。访问页面 4 时应淘汰哪个页面？",
    options: [
      option("A", "页面 1"),
      option("B", "页面 2"),
      option("C", "页面 3"),
      option("D", "不淘汰页面"),
    ],
    correctOptionIds: ["B"],
    explanation: "访问页面 4 前，页框中为 1、2、3；页面 1 刚被再次访问，页面 2 的最近一次访问最早，因此 LRU 淘汰页面 2。",
    tags: ["页面置换算法", "LRU", "缺页"],
  },
  {
    ordinal: 7,
    questionId: "practice-408-v1-07",
    courseId: "course_408_cn",
    subject: "计算机网络",
    conceptId: "cn_c04_02",
    conceptTitle: "虚拟互连网络、IP 地址与 CIDR",
    questionText: "IPv4 地址 192.168.10.130/26 所在 CIDR 地址块的网络地址是哪一项？",
    options: [
      option("A", "192.168.10.0"),
      option("B", "192.168.10.64"),
      option("C", "192.168.10.128"),
      option("D", "192.168.10.192"),
    ],
    correctOptionIds: ["C"],
    explanation: "/26 的每个地址块包含 64 个地址，末字节范围依次为 0-63、64-127、128-191、192-255；130 落在 128-191。",
    tags: ["虚拟互连网络、IP 地址与 CIDR", "CIDR", "网络地址"],
  },
  {
    ordinal: 8,
    questionId: "practice-408-v1-08",
    courseId: "course_408_cn",
    subject: "计算机网络",
    conceptId: "cn_c04_03",
    conceptTitle: "IP 地址、MAC 地址与 ARP",
    questionText: "主机 A 向不同子网中的主机 B 发送一个 IP 数据报。A 发出的第一跳以太网帧中，目的 IP 地址和目的 MAC 地址分别应是什么？",
    options: [
      option("A", "B 的 IP 地址，B 的 MAC 地址"),
      option("B", "默认网关的 IP 地址，B 的 MAC 地址"),
      option("C", "B 的 IP 地址，默认网关接口的 MAC 地址"),
      option("D", "默认网关的 IP 地址，默认网关接口的 MAC 地址"),
    ],
    correctOptionIds: ["C"],
    explanation: "跨子网传输时，IP 数据报的目的 IP 仍是最终主机 B；第一跳链路帧交给默认网关，因此目的 MAC 是默认网关接口的 MAC。",
    tags: ["IP 地址、MAC 地址与 ARP", "ARP", "默认网关"],
  },
];

const SCREENING_IMPORT_BATCH_ID = "import_onboarding_408_v3";
const SCREENING_DATASET_ID = "xuetu_onboarding_screening_408_v3";
const SCREENING_SOURCE_PROVIDER = "xuetu_self_authored";
const SCREENING_SOURCE_URL = "https://xuetu.local/sources/onboarding-screening/408-v3";
const SCREENING_ARCHIVE_SHA256 = createHash("sha256")
  .update(JSON.stringify(ONBOARDING_DIAGNOSTIC_QUESTIONS))
  .digest("hex");
const PRACTICE_IMPORT_BATCH_ID = "import_practice_408_v1";
const PRACTICE_DATASET_ID = "xuetu_self_authored_practice_408_v1";
const PRACTICE_SOURCE_PROVIDER = "xuetu_self_authored";
const PRACTICE_SOURCE_URL = "https://xuetu.local/sources/practice/408-v1";
const PRACTICE_QUESTION_COURSE_ID = "course_408_001";
const PRACTICE_ARCHIVE_SHA256 = createHash("sha256")
  .update(JSON.stringify(SELF_AUTHORED_PRACTICE_QUESTIONS))
  .digest("hex");

interface ValidationRow {
  question_id: string;
  year: number | null;
  subject: string;
  question_type: string;
  answer_count: number | string;
  asset_count: number | string;
  has_figure_marker: boolean;
  concept_id: string | null;
  question_course_id: string | null;
  course_id: string | null;
  active_link_count: number | string;
  source_type: string;
  allowed_modes: string[];
  paper_year: number | null;
  protect_full_paper: boolean;
  content_review_status: string;
}

function publicOptions(definition: OnboardingDiagnosticQuestionDefinition) {
  return definition.options.map((item) => ({
    option_id: item.optionId,
    text: item.text,
    assets: [],
  }));
}

interface DefinitionValidationConfig {
  label: string;
  datasetId: string;
  sourceProvider: string;
  sourceUrl: string;
  sourceType: "self_authored_screening" | "self_authored_practice";
  allowedModes: readonly ("diagnostic" | "targeted" | "mock_exam")[];
  year: number | null;
  paperYear: number | null;
}

function validateDefinitionSet(
  definitions: readonly OnboardingDiagnosticQuestionDefinition[],
  ids: Set<string>,
  config: DefinitionValidationConfig,
) {
  for (const definition of definitions) {
    if (ids.has(definition.questionId)) {
      throw new Error(`Duplicate self-authored question id: ${definition.questionId}.`);
    }
    ids.add(definition.questionId);
    const options = publicOptions(definition);
    const optionIds = new Set(options.map((item) => item.option_id));
    if (
      definition.correctOptionIds.length < 1
      || new Set(definition.correctOptionIds).size !== definition.correctOptionIds.length
      || definition.correctOptionIds.some((item) => !optionIds.has(item))
    ) {
      throw new Error(`Invalid ${config.label} answer key: ${definition.questionId}.`);
    }
    questionDtoSchema.parse({
      id: definition.questionId,
      year: config.year,
      number: definition.ordinal,
      subject: definition.subject,
      type: "choice",
      multiple: definition.correctOptionIds.length > 1,
      question: definition.questionText,
      options,
      tags: definition.tags,
      assets: [],
      content_format: "plain_text",
      source: {
        provider: config.sourceProvider,
        dataset_id: config.datasetId,
        source_url: config.sourceUrl,
        license_status: "verified",
        usage_scope: "authorized_product_use",
      },
    });
    questionLearningMetadataSchema.parse({
      source_type: config.sourceType,
      allowed_modes: [...config.allowedModes],
      paper_year: config.paperYear,
      protect_full_paper: false,
      importance: "core",
      content_review_status: "pending_teacher_review",
    });
  }
}

function validateDefinitions() {
  const ids = new Set<string>();
  validateDefinitionSet(ONBOARDING_DIAGNOSTIC_QUESTIONS, ids, {
    label: "diagnostic",
    datasetId: SCREENING_DATASET_ID,
    sourceProvider: SCREENING_SOURCE_PROVIDER,
    sourceUrl: SCREENING_SOURCE_URL,
    sourceType: "self_authored_screening",
    allowedModes: ["diagnostic"],
    year: null,
    paperYear: null,
  });
  validateDefinitionSet(SELF_AUTHORED_PRACTICE_QUESTIONS, ids, {
    label: "practice",
    datasetId: PRACTICE_DATASET_ID,
    sourceProvider: PRACTICE_SOURCE_PROVIDER,
    sourceUrl: PRACTICE_SOURCE_URL,
    sourceType: "self_authored_practice",
    allowedModes: ["targeted", "mock_exam"],
    year: 2026,
    paperYear: 2026,
  });
}

export async function seedOnboardingDiagnosticQuestions(
  pool: SqlQueryablePool,
): Promise<{
  setVersion: typeof ONBOARDING_DIAGNOSTIC_SET_VERSION;
  questionCount: number;
  practiceQuestionCount: number;
}> {
  validateDefinitions();
  const timestamp = new Date().toISOString();
  const ids = [
    ...ONBOARDING_DIAGNOSTIC_QUESTIONS.map((item) => item.questionId),
    ...SELF_AUTHORED_PRACTICE_QUESTIONS.map((item) => item.questionId),
  ];

  return withTransaction(pool, async (client) => {
    const batch = await client.query<{ import_batch_id: string }>(
      `INSERT INTO question_import_batches(
         import_batch_id, dataset_id, archive_sha256, source_provider, source_url,
         license_status, usage_scope, status, question_count, started_at, completed_at
       ) VALUES ($1,$2,$3,$4,$5,'verified','authorized_product_use','completed',$6,$7,$7)
       ON CONFLICT (import_batch_id) DO UPDATE SET
         dataset_id = EXCLUDED.dataset_id,
         archive_sha256 = EXCLUDED.archive_sha256,
         source_provider = EXCLUDED.source_provider,
         source_url = EXCLUDED.source_url,
         license_status = EXCLUDED.license_status,
         usage_scope = EXCLUDED.usage_scope,
         status = 'completed',
         question_count = EXCLUDED.question_count,
         completed_at = EXCLUDED.completed_at
       RETURNING import_batch_id`,
      [
        SCREENING_IMPORT_BATCH_ID,
        SCREENING_DATASET_ID,
        SCREENING_ARCHIVE_SHA256,
        SCREENING_SOURCE_PROVIDER,
        SCREENING_SOURCE_URL,
        ONBOARDING_DIAGNOSTIC_QUESTIONS.length,
        timestamp,
      ],
    );
    const importBatchId = batch.rows[0]?.import_batch_id;
    if (!importBatchId) throw new Error("Onboarding screening import batch returned no identifier.");

    const practiceBatch = await client.query<{ import_batch_id: string }>(
      `INSERT INTO question_import_batches(
         import_batch_id, dataset_id, archive_sha256, source_provider, source_url,
         license_status, usage_scope, status, question_count, started_at, completed_at
       ) VALUES ($1,$2,$3,$4,$5,'verified','authorized_product_use','completed',$6,$7,$7)
       ON CONFLICT (import_batch_id) DO UPDATE SET
         dataset_id = EXCLUDED.dataset_id,
         archive_sha256 = EXCLUDED.archive_sha256,
         source_provider = EXCLUDED.source_provider,
         source_url = EXCLUDED.source_url,
         license_status = EXCLUDED.license_status,
         usage_scope = EXCLUDED.usage_scope,
         status = 'completed',
         question_count = EXCLUDED.question_count,
         completed_at = EXCLUDED.completed_at
       RETURNING import_batch_id`,
      [
        PRACTICE_IMPORT_BATCH_ID,
        PRACTICE_DATASET_ID,
        PRACTICE_ARCHIVE_SHA256,
        PRACTICE_SOURCE_PROVIDER,
        PRACTICE_SOURCE_URL,
        SELF_AUTHORED_PRACTICE_QUESTIONS.length,
        timestamp,
      ],
    );
    const practiceImportBatchId = practiceBatch.rows[0]?.import_batch_id;
    if (!practiceImportBatchId) throw new Error("Practice question import batch returned no identifier.");

    for (const definition of ONBOARDING_DIAGNOSTIC_QUESTIONS) {
      await client.query(
        `INSERT INTO questions(
           question_id, course_id, import_batch_id, year, number, subject,
           question_type, multiple, question_text, options, tags, assets,
           answer_key, explanation_text, solution_text, source_url,
           license_status, usage_scope, review_status, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,'choice',false,$7,$8::jsonb,$9::text[],'[]'::jsonb,
                   $10::jsonb,$11,NULL,$12,'verified','authorized_product_use','pending_review',$13,$13)
         ON CONFLICT (question_id) DO UPDATE SET
           course_id = EXCLUDED.course_id,
           import_batch_id = EXCLUDED.import_batch_id,
           year = EXCLUDED.year,
           number = EXCLUDED.number,
           subject = EXCLUDED.subject,
           question_type = EXCLUDED.question_type,
           multiple = EXCLUDED.multiple,
           question_text = EXCLUDED.question_text,
           options = EXCLUDED.options,
           tags = EXCLUDED.tags,
           assets = EXCLUDED.assets,
           answer_key = EXCLUDED.answer_key,
           explanation_text = EXCLUDED.explanation_text,
           solution_text = EXCLUDED.solution_text,
           source_url = EXCLUDED.source_url,
           license_status = EXCLUDED.license_status,
           usage_scope = EXCLUDED.usage_scope,
           updated_at = EXCLUDED.updated_at`,
        [
          definition.questionId,
          definition.courseId,
          importBatchId,
          null,
          definition.ordinal,
          definition.subject,
          definition.questionText,
          JSON.stringify(publicOptions(definition)),
          definition.tags,
          JSON.stringify(definition.correctOptionIds),
          definition.explanation,
          SCREENING_SOURCE_URL,
          timestamp,
        ],
      );
      await client.query(
        `INSERT INTO question_learning_metadata(
           question_id, source_type, allowed_modes, paper_year,
           protect_full_paper, importance, content_review_status,
           created_at, updated_at
         ) VALUES (
           $1, 'self_authored_screening', ARRAY['diagnostic']::text[], NULL,
           false, 'core', 'pending_teacher_review', $2, $2
         )
         ON CONFLICT (question_id) DO UPDATE SET
           source_type = EXCLUDED.source_type,
           allowed_modes = EXCLUDED.allowed_modes,
           paper_year = EXCLUDED.paper_year,
           protect_full_paper = EXCLUDED.protect_full_paper,
           importance = EXCLUDED.importance,
           content_review_status = CASE
             WHEN question_learning_metadata.content_review_status = 'teacher_verified'
               THEN 'teacher_verified'
             ELSE EXCLUDED.content_review_status
           END,
           updated_at = EXCLUDED.updated_at`,
        [definition.questionId, timestamp],
      );
      await client.query(
        `INSERT INTO course_concept_question_links(
           concept_id, question_id, matched_tag, match_method, rule_version,
           status, created_at, updated_at
         ) VALUES ($1,$2,$3,'exact_question_tag','v1_exact_unique_tag','active',$4,$4)
         ON CONFLICT (concept_id, question_id) DO UPDATE SET
           matched_tag = EXCLUDED.matched_tag,
           status = 'active',
           updated_at = EXCLUDED.updated_at`,
        [definition.conceptId, definition.questionId, definition.conceptTitle, timestamp],
      );
      await client.query(
        `INSERT INTO onboarding_diagnostic_questions(
           set_version, ordinal, question_id, course_id, subject, concept_id, active
         ) VALUES ($1,$2,$3,$4,$5,$6,true)
         ON CONFLICT (set_version, ordinal) DO UPDATE SET
           question_id = EXCLUDED.question_id,
           course_id = EXCLUDED.course_id,
           subject = EXCLUDED.subject,
           concept_id = EXCLUDED.concept_id,
           active = true,
           updated_at = now()`,
        [
          ONBOARDING_DIAGNOSTIC_SET_VERSION,
          definition.ordinal,
          definition.questionId,
          definition.courseId,
          definition.subject,
          definition.conceptId,
        ],
      );
    }

    for (const definition of SELF_AUTHORED_PRACTICE_QUESTIONS) {
      await client.query(
        `INSERT INTO questions(
           question_id, course_id, import_batch_id, year, number, subject,
           question_type, multiple, question_text, options, tags, assets,
           answer_key, explanation_text, solution_text, source_url,
           license_status, usage_scope, review_status, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,'choice',false,$7,$8::jsonb,$9::text[],'[]'::jsonb,
                   $10::jsonb,$11,NULL,$12,'verified','authorized_product_use','pending_review',$13,$13)
         ON CONFLICT (question_id) DO UPDATE SET
           course_id = EXCLUDED.course_id,
           import_batch_id = EXCLUDED.import_batch_id,
           year = EXCLUDED.year,
           number = EXCLUDED.number,
           subject = EXCLUDED.subject,
           question_type = EXCLUDED.question_type,
           multiple = EXCLUDED.multiple,
           question_text = EXCLUDED.question_text,
           options = EXCLUDED.options,
           tags = EXCLUDED.tags,
           assets = EXCLUDED.assets,
           answer_key = EXCLUDED.answer_key,
           explanation_text = EXCLUDED.explanation_text,
           solution_text = EXCLUDED.solution_text,
           source_url = EXCLUDED.source_url,
           license_status = EXCLUDED.license_status,
           usage_scope = EXCLUDED.usage_scope,
           updated_at = EXCLUDED.updated_at`,
        [
          definition.questionId,
          PRACTICE_QUESTION_COURSE_ID,
          practiceImportBatchId,
          null,
          definition.ordinal,
          definition.subject,
          definition.questionText,
          JSON.stringify(publicOptions(definition)),
          definition.tags,
          JSON.stringify(definition.correctOptionIds),
          definition.explanation,
          PRACTICE_SOURCE_URL,
          timestamp,
        ],
      );
      await client.query(
        `INSERT INTO question_learning_metadata(
           question_id, source_type, allowed_modes, paper_year,
           protect_full_paper, importance, content_review_status,
           created_at, updated_at
         ) VALUES (
           $1, 'self_authored_practice', ARRAY['targeted','mock_exam']::text[], 2026,
           false, 'core', 'pending_teacher_review', $2, $2
         )
         ON CONFLICT (question_id) DO UPDATE SET
           source_type = EXCLUDED.source_type,
           allowed_modes = EXCLUDED.allowed_modes,
           paper_year = EXCLUDED.paper_year,
           protect_full_paper = EXCLUDED.protect_full_paper,
           importance = EXCLUDED.importance,
           content_review_status = CASE
             WHEN question_learning_metadata.content_review_status = 'teacher_verified'
               THEN 'teacher_verified'
             ELSE EXCLUDED.content_review_status
           END,
           updated_at = EXCLUDED.updated_at`,
        [definition.questionId, timestamp],
      );
      await client.query(
        `INSERT INTO course_concept_question_links(
           concept_id, question_id, matched_tag, match_method, rule_version,
           status, created_at, updated_at
         ) VALUES ($1,$2,$3,'exact_question_tag','v1_exact_unique_tag','active',$4,$4)
         ON CONFLICT (concept_id, question_id) DO UPDATE SET
           matched_tag = EXCLUDED.matched_tag,
           status = 'active',
           updated_at = EXCLUDED.updated_at`,
        [definition.conceptId, definition.questionId, definition.conceptTitle, timestamp],
      );
    }

    const validation = await client.query<ValidationRow>(
      `SELECT q.question_id,
              q.year,
              q.subject,
              q.question_type,
              jsonb_array_length(q.answer_key)::int AS answer_count,
               jsonb_array_length(q.assets)::int AS asset_count,
               (q.question_text LIKE '%[图]%' OR q.options::text LIKE '%[图]%') AS has_figure_marker,
               cql.concept_id,
               q.course_id AS question_course_id,
               c.course_id,
              COUNT(cql.question_id) OVER (PARTITION BY q.question_id)::int AS active_link_count,
              meta.source_type,
              meta.allowed_modes,
              meta.paper_year,
              meta.protect_full_paper,
              meta.content_review_status
       FROM questions q
       JOIN question_learning_metadata meta ON meta.question_id = q.question_id
       LEFT JOIN course_concept_question_links cql
         ON cql.question_id = q.question_id AND cql.status = 'active'
       LEFT JOIN course_core_concepts c ON c.concept_id = cql.concept_id
       WHERE q.question_id = ANY($1::text[])
         AND q.review_status <> 'rejected'`,
      [ids],
    );
    const rowsById = new Map(validation.rows.map((row) => [row.question_id, row]));
    for (const definition of ONBOARDING_DIAGNOSTIC_QUESTIONS) {
      const row = rowsById.get(definition.questionId);
      if (
        !row
        || row.year !== null
        || row.subject !== definition.subject
        || row.question_type !== "choice"
        || Number(row.answer_count) < 1
        || Number(row.asset_count) > 0
        || row.has_figure_marker
        || row.question_course_id !== definition.courseId
        || row.course_id !== definition.courseId
        || row.concept_id !== definition.conceptId
        || Number(row.active_link_count) !== 1
        || row.source_type !== "self_authored_screening"
        || row.allowed_modes.length !== 1
        || row.allowed_modes[0] !== "diagnostic"
        || row.paper_year !== null
        || row.protect_full_paper
        || !["pending_teacher_review", "teacher_verified"].includes(row.content_review_status)
      ) {
        throw new Error(`The fixed diagnostic question set is unavailable: ${definition.questionId}.`);
      }
    }
    for (const definition of SELF_AUTHORED_PRACTICE_QUESTIONS) {
      const row = rowsById.get(definition.questionId);
      if (
        !row
        || row.year !== null
        || row.subject !== definition.subject
        || row.question_type !== "choice"
        || Number(row.answer_count) < 1
        || Number(row.asset_count) > 0
        || row.has_figure_marker
        || row.question_course_id !== PRACTICE_QUESTION_COURSE_ID
        || row.course_id !== definition.courseId
        || row.concept_id !== definition.conceptId
        || Number(row.active_link_count) !== 1
        || row.source_type !== "self_authored_practice"
        || row.allowed_modes.length !== 2
        || row.allowed_modes[0] !== "targeted"
        || row.allowed_modes[1] !== "mock_exam"
        || row.paper_year !== 2026
        || row.protect_full_paper
        || !["pending_teacher_review", "teacher_verified"].includes(row.content_review_status)
      ) {
        throw new Error(`The fixed practice question set is unavailable: ${definition.questionId}.`);
      }
    }

    await client.query(
      `INSERT INTO student_onboarding_diagnostic_answers(
         user_id, set_version, question_id, response_status,
         selected_option_ids, is_correct, evaluated_at, created_at, updated_at
       )
       SELECT answer.user_id, $2, answer.question_id, answer.response_status,
              answer.selected_option_ids, answer.is_correct, answer.evaluated_at,
              answer.created_at, answer.updated_at
       FROM student_onboarding_diagnostic_answers AS answer
       JOIN student_onboarding_states AS state
         ON state.user_id = answer.user_id
        AND state.diagnostic_set_version = ANY($1::text[])
        AND state.status <> 'completed'
       JOIN onboarding_diagnostic_questions AS next_question
         ON next_question.set_version = $2
        AND next_question.question_id = answer.question_id
        AND next_question.active = true
       WHERE answer.set_version = state.diagnostic_set_version
       ON CONFLICT (user_id, set_version, question_id) DO NOTHING`,
      [LEGACY_ONBOARDING_DIAGNOSTIC_SET_VERSIONS, ONBOARDING_DIAGNOSTIC_SET_VERSION],
    );
    await client.query(
      `UPDATE student_onboarding_states AS state
       SET diagnostic_set_version = $2
       WHERE state.diagnostic_set_version = ANY($1::text[])
         AND state.status <> 'completed'`,
      [LEGACY_ONBOARDING_DIAGNOSTIC_SET_VERSIONS, ONBOARDING_DIAGNOSTIC_SET_VERSION],
    );

    return {
      setVersion: ONBOARDING_DIAGNOSTIC_SET_VERSION,
      questionCount: ONBOARDING_DIAGNOSTIC_QUESTIONS.length,
      practiceQuestionCount: SELF_AUTHORED_PRACTICE_QUESTIONS.length,
    };
  });
}

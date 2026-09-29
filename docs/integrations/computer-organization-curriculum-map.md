# 计算机组成原理课程化知识体系

## 两层数据

1. `data/course-materials/computer-organization/raw/knowledge.json`
   保留 504 条原始 OCR 切片，只作为可追溯来源，不直接成为学生知识树节点。
2. `data/course-materials/computer-organization/curated/curriculum-map.json`
   将有效学习内容组织为“章节 → 学习模块 → 核心知识点”，供学生课程知识地图使用。

原始切片不被删除、改写或回填课程化标题。

## 第一版覆盖

- 10 个有效学习章节；不含前言、目录和参考资料。
- 21 个学习模块。
- 46 个核心知识点，每章 3–7 个。
- 47 条 `chunk_id + 印刷页` 来源引用。
- 当前所有来源引用均须在导入前验证：chunk 存在、页码一致、所属原始章节一致。
- `review_status` 支持 `verified / needs_review`；不能可靠归纳的内容不得作为已确认事实。

## 每个核心知识点

- 学生可读标题
- 1–2 句学习目标
- 前置知识点 ID
- 关键术语
- 一个易混点或学习提醒
- 一个或多个原始 `chunk_id + print_page`
- `importance=core|extended`
- `review_status=verified|needs_review`

## PostgreSQL 落点

- `course_learning_modules`
- `course_core_concepts`
- `course_concept_sources`
- `course_concept_terms`
- `course_concept_prerequisites`

JSON 仅是可重复导入源，运行时课程知识地图由 PostgreSQL API 返回。

## API

`GET /api/v1/408/courses/computer-organization/curriculum-map`

返回三层知识地图、来源切片位置、派生概念数和可追溯率。学生页面不会渲染
`chunk_id / print_page / hash / license_status` 等内部溯源元数据，但后台记录继续保留。

## 图示边界

只保留已经人工核验并映射到 `k0013` 的图 1.1、图 1.2、图 1.3。第一版不批量抽取或展示全书图片；后续只为少量关键概念单独提出可核验方案。


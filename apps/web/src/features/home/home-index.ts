import {
  BookOpen,
  Bug,
  Code2,
  GitBranch,
  History,
  ListChecks,
  Network,
  Target,
  type LucideIcon,
} from "lucide-react";

export type HomeIndexGroup = "课程与任务" | "平台功能";

export interface HomeSearchItem {
  id: string;
  title: string;
  description: string;
  keywords: string[];
  group: HomeIndexGroup;
  href: string;
  icon: LucideIcon;
}

export interface HomeCategory {
  id: string;
  title: string;
  description: string;
  moduleSummary: string;
  href: string;
  icon: LucideIcon;
}

export const homeCategories: HomeCategory[] = [
  {
    id: "learn",
    title: "学课程",
    description: "沿课程结构理解知识，并把零散内容串成路径。",
    moduleSummary: "专业课程 · 知识图谱 · 学习路径",
    href: "/student/courses",
    icon: BookOpen,
  },
  {
    id: "code",
    title: "练代码",
    description: "从编写、测试到错误诊断，完成一次完整练习。",
    moduleSummary: "仿真实验 · 测试探索器 · 错题诊断",
    href: "/student/practice",
    icon: Code2,
  },
  {
    id: "growth",
    title: "看成长",
    description: "按课程查看个人画像、错题与下一步学习行动。",
    moduleSummary: "我的学习 · 错题复习 · 课程画像",
    href: "/student/profile",
    icon: Target,
  },
];

export const homeSearchItems: HomeSearchItem[] = [
  {
    id: "courses",
    title: "专业课程",
    description: "浏览计算机科学与技术专业的课程入口与学习进度。",
    keywords: ["课程", "数据结构", "计算机科学与技术", "学习", "资料", "视频"],
    group: "课程与任务",
    href: "/student/courses",
    icon: BookOpen,
  },
  {
    id: "knowledge-graph",
    title: "知识图谱",
    description: "查看数据结构知识点之间的前置关系与关联脉络。",
    keywords: ["图谱", "知识点", "关系", "数据结构"],
    group: "课程与任务",
    href: "/student/courses/data-structures",
    icon: Network,
  },
  {
    id: "learning-plan",
    title: "学习路径",
    description: "按照掌握情况进入个性化任务与阶段计划。",
    keywords: ["路径", "计划", "任务", "个性化"],
    group: "课程与任务",
    href: "/student/plan",
    icon: GitBranch,
  },
  {
    id: "practice",
    title: "仿真实验中心",
    description: "选择语言完成代码编写、运行与提交。",
    keywords: ["编程", "代码", "提交", "运行", "语言"],
    group: "课程与任务",
    href: "/student/practice",
    icon: Code2,
  },
  {
    id: "bfs-trace",
    title: "BFS 运行轨迹",
    description: "逐步观察广度优先遍历中的队列与访问状态。",
    keywords: ["bfs", "BFS", "广度优先遍历", "运行轨迹", "队列", "visited"],
    group: "课程与任务",
    href: "/student/tasks/task_bfs_bug_001",
    icon: GitBranch,
  },
  {
    id: "test-lab",
    title: "测试探索器",
    description: "查看测试用例、边界输入与程序执行结果。",
    keywords: ["测试", "用例", "边界", "结果", "调试"],
    group: "平台功能",
    href: "/student/test-lab",
    icon: ListChecks,
  },
  {
    id: "mistakes",
    title: "错题诊断",
    description: "定位错误原因，并获得针对性的修复建议。",
    keywords: ["错题", "错误", "诊断", "修复", "归因"],
    group: "平台功能",
    href: "/student/mistakes",
    icon: Bug,
  },
  {
    id: "ability",
    title: "我的学习",
    description: "切换四门课程查看真实学习画像、薄弱点与错题。",
    keywords: ["能力", "评估", "雷达图", "成长", "证据", "记录", "掌握", "个人", "档案"],
    group: "平台功能",
    href: "/student/profile",
    icon: Target,
  },
];

function normalizeQuery(value: string) {
  return value.trim().toLocaleLowerCase("zh-CN").replace(/\s+/g, " ");
}

export function searchHomeIndex(query: string) {
  const normalizedQuery = normalizeQuery(query);

  if (!normalizedQuery) {
    return homeSearchItems.slice(0, 5);
  }

  return homeSearchItems
    .map((item) => {
      const title = normalizeQuery(item.title);
      const keywords = normalizeQuery(item.keywords.join(" "));
      const description = normalizeQuery(item.description);
      const rank = title.includes(normalizedQuery)
        ? 0
        : keywords.includes(normalizedQuery)
          ? 1
          : description.includes(normalizedQuery)
            ? 2
            : -1;

      return { item, rank };
    })
    .filter((result) => result.rank >= 0)
    .sort((left, right) => left.rank - right.rank)
    .map((result) => result.item);
}

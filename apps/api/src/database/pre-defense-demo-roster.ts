// Fixed, explicitly synthetic classroom scenarios using verified curriculum concepts.
export const PRE_DEFENSE_COURSES = [
  { courseId: "course_408_ds", focuses: [
    { conceptId: "ds_c01_01", title: "数据、数据元素与数据项" },
    { conceptId: "ds_c01_05", title: "时间、空间与渐近复杂度" },
    { conceptId: "ds_c02_05", title: "带头结点、循环链表与双向链表" },
    { conceptId: "ds_c03_03", title: "括号匹配与表达式求值" },
    { conceptId: "ds_c04_03", title: "稀疏矩阵与三元组表" },
    { conceptId: "ds_c05_02", title: "二叉树性质与存储" },
    { conceptId: "ds_c05_07", title: "堆与堆操作" },
    { conceptId: "ds_c06_03", title: "广度优先搜索与连通分量" },
    { conceptId: "ds_c06_08", title: "拓扑排序与关键路径" },
    { conceptId: "ds_c07_04", title: "AVL树的平衡旋转" },
    { conceptId: "ds_c08_03", title: "冒泡与快速排序" },
    { conceptId: "ds_c08_07", title: "外排序与缓冲区" },
  ] },
  { courseId: "course_408_co", focuses: [
    { conceptId: "co_c01_01", title: "硬件、软件与计算机系统" },
    { conceptId: "co_c01_05", title: "取指、分析与执行" },
    { conceptId: "co_c03_01", title: "总线连接与共享传输" },
    { conceptId: "co_c04_01", title: "存储体系的层次结构" },
    { conceptId: "co_c04_05", title: "Cache 地址映射方式" },
    { conceptId: "co_c05_04", title: "中断向量与中断接口" },
    { conceptId: "co_c06_04", title: "机器乘法的移位与累加" },
    { conceptId: "co_c07_01", title: "机器指令与指令格式" },
    { conceptId: "co_c08_01", title: "CPU 的功能与内部组织" },
    { conceptId: "co_c08_05", title: "中断的作用与来源" },
    { conceptId: "co_c10_01", title: "组合逻辑控制单元" },
    { conceptId: "co_c10_05", title: "下一微地址的形成" },
  ] },
  { courseId: "course_408_os", focuses: [
    { conceptId: "os_c01_01", title: "操作系统的作用" },
    { conceptId: "os_c02_01", title: "程序、进程与并发执行" },
    { conceptId: "os_c03_02", title: "实时任务调度" },
    { conceptId: "os_c04_02", title: "连续分配与动态分区" },
    { conceptId: "os_c05_02", title: "请求分页与缺页中断" },
    { conceptId: "os_c06_03", title: "中断与DMA控制" },
    { conceptId: "os_c07_03", title: "目录、FCB与索引结点" },
    { conceptId: "os_c08_04", title: "RAID与存储可靠性" },
    { conceptId: "os_c09_04", title: "系统调用与POSIX" },
    { conceptId: "os_c10_04", title: "多处理机调度与死锁" },
    { conceptId: "os_c11_05", title: "媒体存储与磁盘调度" },
    { conceptId: "os_c12_05", title: "访问控制模型与可信计算基" },
  ] },
  { courseId: "course_408_cn", focuses: [
    { conceptId: "cn_c01_01", title: "网络、互连网与互联网" },
    { conceptId: "cn_c01_05", title: "时延、时延带宽积与利用率" },
    { conceptId: "cn_c02_04", title: "导引与非导引传输媒体" },
    { conceptId: "cn_c03_03", title: "局域网、适配器与 MAC 地址" },
    { conceptId: "cn_c04_02", title: "虚拟互连网络、IP 地址与 CIDR" },
    { conceptId: "cn_c04_06", title: "RIP、OSPF 与 BGP 路由选择" },
    { conceptId: "cn_c05_04", title: "TCP 首部、滑动窗口与重传" },
    { conceptId: "cn_c06_02", title: "URL、HTTP 与万维网交互" },
    { conceptId: "cn_c07_01", title: "被动攻击、主动攻击与安全目标" },
    { conceptId: "cn_c07_05", title: "防火墙与入侵检测" },
    { conceptId: "cn_c09_01", title: "BSS、ESS 与无线接入" },
    { conceptId: "cn_c09_05", title: "蜂窝网络、LTE 与移动 IP" },
  ] },
] as const;

export interface DemoClass {
  classId: string;
  cohortYear: number;
  major: string;
  className: string;
}

export const PRE_DEFENSE_CLASSES: readonly DemoClass[] = [
  { classId: "class_se_2022_01", cohortYear: 2022, major: "软件工程", className: "软件工程2201班" },
  { classId: "class_se_2022_02", cohortYear: 2022, major: "软件工程", className: "软件工程2202班" },
  { classId: "class_cs_2022_01", cohortYear: 2022, major: "计算机科学与技术", className: "计算机科学与技术2201班" },
  { classId: "class_cs_2022_02", cohortYear: 2022, major: "计算机科学与技术", className: "计算机科学与技术2202班" },
  { classId: "class_se_2023_01", cohortYear: 2023, major: "软件工程", className: "软件工程2301班" },
  { classId: "class_se_2023_02", cohortYear: 2023, major: "软件工程", className: "软件工程2302班" },
  { classId: "class_cs_2023_01", cohortYear: 2023, major: "计算机科学与技术", className: "计算机科学与技术2301班" },
  { classId: "class_cs_2023_02", cohortYear: 2023, major: "计算机科学与技术", className: "计算机科学与技术2302班" },
  { classId: "class_se_2024_01", cohortYear: 2024, major: "软件工程", className: "软件工程2401班" },
  { classId: "class_se_2024_02", cohortYear: 2024, major: "软件工程", className: "软件工程2402班" },
  { classId: "class_cs_2024_01", cohortYear: 2024, major: "计算机科学与技术", className: "计算机科学与技术2401班" },
  { classId: "class_cs_2024_02", cohortYear: 2024, major: "计算机科学与技术", className: "计算机科学与技术2402班" },
];

export const PRE_DEFENSE_TARGET_SCHOOLS = [
  { circleId: "circle_xju", schoolName: "新疆大学" },
  { circleId: "circle_zzu", schoolName: "郑州大学" },
  { circleId: "circle_ustc", schoolName: "中国科学技术大学" },
  { circleId: "circle_bupt", schoolName: "北京邮电大学" },
  { circleId: "circle_xidian", schoolName: "西安电子科技大学" },
  { circleId: "circle_hdu", schoolName: "杭州电子科技大学" },
  { circleId: "circle_njupt", schoolName: "南京邮电大学" },
  { circleId: "circle_cqupt", schoolName: "重庆邮电大学" },
] as const;

type LearningStatus = "on_track" | "needs_attention" | "inactive";

export interface DemoStudent {
  userId: string;
  displayName: string;
  studentNumber: string;
  cohortYear: number;
  classId: string;
  baseProgress: number;
  baseAccuracy: number;
  activityOffsetDays: number;
  learningStatus: LearningStatus;
  targetSchool: string | null;
}

const BASE_PRE_DEFENSE_STUDENTS: readonly DemoStudent[] = [
  { userId: "demo_student_2215929107", displayName: "赵晨宇", studentNumber: "2215929107", cohortYear: 2022, classId: "class_se_2022_01", baseProgress: 82, baseAccuracy: 84, activityOffsetDays: 0, learningStatus: "on_track", targetSchool: "北京邮电大学" },
  { userId: "demo_student_2215929124", displayName: "林雨桐", studentNumber: "2215929124", cohortYear: 2022, classId: "class_se_2022_01", baseProgress: 74, baseAccuracy: 76, activityOffsetDays: 1, learningStatus: "on_track", targetSchool: "西安电子科技大学" },
  { userId: "demo_student_2215929146", displayName: "周子航", studentNumber: "2215929146", cohortYear: 2022, classId: "class_se_2022_01", baseProgress: 68, baseAccuracy: 58, activityOffsetDays: 2, learningStatus: "needs_attention", targetSchool: "新疆大学" },
  { userId: "demo_student_2215929183", displayName: "孙嘉怡", studentNumber: "2215929183", cohortYear: 2022, classId: "class_cs_2022_02", baseProgress: 88, baseAccuracy: 87, activityOffsetDays: 0, learningStatus: "on_track", targetSchool: "中国科学技术大学" },
  { userId: "demo_student_2215929215", displayName: "蒋文浩", studentNumber: "2215929215", cohortYear: 2022, classId: "class_cs_2022_02", baseProgress: 63, baseAccuracy: 61, activityOffsetDays: 3, learningStatus: "needs_attention", targetSchool: "郑州大学" },
  { userId: "demo_student_2215929258", displayName: "沈欣然", studentNumber: "2215929258", cohortYear: 2022, classId: "class_cs_2022_02", baseProgress: 57, baseAccuracy: 66, activityOffsetDays: 9, learningStatus: "inactive", targetSchool: "杭州电子科技大学" },
  { userId: "demo_student_2315929302", displayName: "陈奕帆", studentNumber: "2315929302", cohortYear: 2023, classId: "class_se_2023_01", baseProgress: 61, baseAccuracy: 73, activityOffsetDays: 1, learningStatus: "on_track", targetSchool: "南京邮电大学" },
  { userId: "demo_student_2315929327", displayName: "刘思涵", studentNumber: "2315929327", cohortYear: 2023, classId: "class_se_2023_01", baseProgress: 55, baseAccuracy: 69, activityOffsetDays: 0, learningStatus: "on_track", targetSchool: "重庆邮电大学" },
  { userId: "demo_student_2315929354", displayName: "许泽宇", studentNumber: "2315929354", cohortYear: 2023, classId: "class_se_2023_01", baseProgress: 43, baseAccuracy: 54, activityOffsetDays: 2, learningStatus: "needs_attention", targetSchool: "新疆大学" },
  { userId: "demo_student_2315929381", displayName: "韩若曦", studentNumber: "2315929381", cohortYear: 2023, classId: "class_cs_2023_02", baseProgress: 67, baseAccuracy: 79, activityOffsetDays: 0, learningStatus: "on_track", targetSchool: "北京邮电大学" },
  { userId: "demo_student_2315929416", displayName: "郑博文", studentNumber: "2315929416", cohortYear: 2023, classId: "class_cs_2023_02", baseProgress: 38, baseAccuracy: 57, activityOffsetDays: 4, learningStatus: "needs_attention", targetSchool: "郑州大学" },
  { userId: "demo_student_2315929459", displayName: "唐诗雨", studentNumber: "2315929459", cohortYear: 2023, classId: "class_cs_2023_02", baseProgress: 32, baseAccuracy: 62, activityOffsetDays: 11, learningStatus: "inactive", targetSchool: "西安电子科技大学" },
  // Only the student number was supplied by the user. Class and progress remain demo assumptions.
  { userId: "user_student_001", displayName: "程嘉树", studentNumber: "2415929524", cohortYear: 2024, classId: "class_se_2024_02", baseProgress: 29, baseAccuracy: 68, activityOffsetDays: 0, learningStatus: "on_track", targetSchool: null },
];

const DEMO_SURNAMES = [
  "王", "李", "张", "刘", "陈", "杨", "黄", "赵", "吴", "周", "徐", "孙",
  "马", "朱", "胡", "郭", "何", "高", "林", "罗", "郑", "梁", "谢", "宋",
] as const;
const DEMO_GIVEN_NAMES = [
  "子涵", "浩然", "欣怡", "嘉豪", "雨欣", "宇轩", "思远", "若彤", "文博", "语桐", "明哲", "佳宁",
  "晨曦", "梓航", "诗涵", "俊杰", "可欣", "奕辰", "梦瑶", "泽宇", "婉清", "博文", "依诺", "承恩",
] as const;

const GENERATED_PRE_DEFENSE_STUDENTS: readonly DemoStudent[] = Array.from(
  { length: 275 },
  (_, index) => {
    const cohortYear = 2022 + (index % 3);
    const classes = PRE_DEFENSE_CLASSES.filter((item) => item.cohortYear === cohortYear);
    const classItem = classes[index % classes.length]!;
    const studentNumber = `${String(cohortYear).slice(2)}159${String(30_000 + index).padStart(5, "0")}`;
    const inactive = index % 17 === 0;
    const needsAttention = !inactive && index % 5 === 0;
    return {
      userId: `demo_student_${studentNumber}`,
      displayName: `${DEMO_SURNAMES[index % DEMO_SURNAMES.length]}${DEMO_GIVEN_NAMES[Math.floor(index / DEMO_SURNAMES.length) % DEMO_GIVEN_NAMES.length]}`,
      studentNumber,
      cohortYear,
      classId: classItem.classId,
      baseProgress: 24 + ((index * 11) % 65),
      baseAccuracy: 50 + ((index * 7) % 43),
      activityOffsetDays: inactive ? 9 + (index % 8) : index % 5,
      learningStatus: inactive ? "inactive" : needsAttention ? "needs_attention" : "on_track",
      targetSchool: PRE_DEFENSE_TARGET_SCHOOLS[index % PRE_DEFENSE_TARGET_SCHOOLS.length]!.schoolName,
    };
  },
);

export const PRE_DEFENSE_STUDENTS: readonly DemoStudent[] = [
  ...BASE_PRE_DEFENSE_STUDENTS,
  ...GENERATED_PRE_DEFENSE_STUDENTS,
];

export interface DemoTeacher {
  userId: string;
  username: string;
  displayName: string;
  teacherNumber: string;
  department: string;
  professionalTitle: string;
  courseIds: readonly string[];
  classIds: readonly string[];
}

const BASE_PRE_DEFENSE_TEACHERS: readonly DemoTeacher[] = [
  { userId: "user_teacher_001", username: "user_teacher_001", displayName: "陈明远", teacherNumber: "T2008016", department: "计算机科学与技术系", professionalTitle: "副教授", courseIds: PRE_DEFENSE_COURSES.map((course) => course.courseId), classIds: PRE_DEFENSE_CLASSES.map((item) => item.classId) },
  { userId: "demo_teacher_zhou", username: "teacher_zhou_demo", displayName: "周静怡", teacherNumber: "T2015012", department: "软件工程系", professionalTitle: "讲师", courseIds: ["course_408_ds", "course_408_co"], classIds: ["class_se_2022_01", "class_se_2023_01", "class_se_2024_02"] },
  { userId: "demo_teacher_lin", username: "teacher_lin_demo", displayName: "林志远", teacherNumber: "T2011019", department: "计算机基础教学部", professionalTitle: "副教授", courseIds: ["course_408_os", "course_408_cn"], classIds: ["class_cs_2022_02", "class_cs_2023_02"] },
];

const GENERATED_PRE_DEFENSE_TEACHERS: readonly DemoTeacher[] = Array.from(
  { length: 9 },
  (_, index) => ({
    userId: `demo_teacher_${String(index + 4).padStart(2, "0")}`,
    username: `teacher_demo_${String(index + 4).padStart(2, "0")}`,
    displayName: `${DEMO_SURNAMES[(index + 7) % DEMO_SURNAMES.length]}${["晓岚", "晓峰", "雅雯", "建国", "敏慧", "正阳", "书宁", "海涛", "文静"][index]}`,
    teacherNumber: `T20${String(16 + index).padStart(2, "0")}${String(31 + index).padStart(3, "0")}`,
    department: index % 2 === 0 ? "计算机科学与技术系" : "软件工程系",
    professionalTitle: index % 3 === 0 ? "副教授" : "讲师",
    courseIds: PRE_DEFENSE_COURSES.map((course) => course.courseId),
    classIds: PRE_DEFENSE_CLASSES.filter((_, classIndex) => classIndex % 3 === index % 3)
      .map((item) => item.classId),
  }),
);

export const PRE_DEFENSE_TEACHERS: readonly DemoTeacher[] = [
  ...BASE_PRE_DEFENSE_TEACHERS,
  ...GENERATED_PRE_DEFENSE_TEACHERS,
];

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function scenarioHash(value: string) {
  let result = 2166136261;
  for (const character of value) result = Math.imul(result ^ character.charCodeAt(0), 16777619);
  return result >>> 0;
}

// Keep the historical demo anchored; importing it must never manufacture today's activity.
export function buildPreDefenseCourseProgress() {
  const referenceDay = Date.UTC(2026, 7, 24) - 8 * 60 * 60 * 1000;
  return PRE_DEFENSE_STUDENTS.flatMap((student, studentIndex) => (
    PRE_DEFENSE_COURSES.map((course, courseIndex) => {
      const attemptCount = 12 + ((studentIndex * 3 + courseIndex * 5) % 19);
      const accuracyPercent = clamp(student.baseAccuracy + (courseIndex - 1) * 3 - (studentIndex % 3), 45, 94);
      const correctCount = Math.round(attemptCount * accuracyPercent / 100);
      const incorrectCount = attemptCount - correctCount;
      const progressPercent = clamp(student.baseProgress + [4, -2, 1, -5][courseIndex]!, 8, 96);
      const scenarioKey = `${student.userId}:${course.courseId}`;
      const stage = Math.floor(progressPercent / 100 * course.focuses.length);
      const focusIndex = clamp(stage + (scenarioHash(`${scenarioKey}:focus`) % 5) - 2, 0, course.focuses.length - 1);
      const focus = course.focuses[focusIndex]!;
      const studyMinute = 8 * 60 + scenarioHash(`${scenarioKey}:time`) % (15 * 60);
      const activityDays = student.activityOffsetDays + (courseIndex % 2);
      return {
        userId: student.userId,
        courseId: course.courseId,
        progressPercent,
        correctCount,
        incorrectCount,
        evidenceCount: attemptCount + Math.max(2, Math.round(progressPercent / 12)),
        pendingReviewCount: student.learningStatus === "on_track" ? studentIndex % 3 : 3 + (studentIndex % 4),
        weeklyStudyMinutes: student.learningStatus === "inactive" ? 35 + studentIndex : 180 + ((studentIndex * 37 + courseIndex * 29) % 260),
        currentFocus: focus.title,
        weakConceptId: focus.conceptId,
        learningStatus: student.learningStatus,
        lastActiveAt: new Date(referenceDay - activityDays * 86_400_000 + studyMinute * 60_000).toISOString(),
        dataProvenance: "synthetic_demo" as const,
      };
    })
  ));
}

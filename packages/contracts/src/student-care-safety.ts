const explicitCrisisPatterns = [
  /(?:我)?(?:真的|现在|已经|快要|快)?不想活(?:了|下去|下去了)?/iu,
  /(?:我|自己).{0,10}(?:想|要|准备|打算|控制不住想).{0,8}(?:自杀|轻生|自残|伤害自己)/iu,
  /(?:我|自己).{0,10}(?:想|要|准备|打算).{0,8}(?:结束(?:自己|我的)?的?生命|一了百了)/iu,
  /(?:i\s+(?:really\s+)?(?:want|plan|intend)\s+to\s+(?:kill|hurt)\s+myself|i\s+(?:do\s+not|don't)\s+want\s+to\s+live(?:\s+anymore)?|suicidal|self[-\s]?harm)/iu,
] as const;

export const STUDENT_CARE_CRISIS_GUIDANCE =
  "你现在的安全比学习更重要。请先不要独自承受，立即联系一位身边可信任的人陪着你，并联系当地专业支持或急救资源；如果你在中国大陆且可能马上伤害自己，请拨打 120 或 110。学伴不能提供心理治疗，也不会继续给你安排学习任务。";

export function studentCareCrisisSignalPresent(
  message: string | null | undefined,
) {
  const content = message?.trim();
  if (!content) return false;
  return explicitCrisisPatterns.some((pattern) => pattern.test(content));
}

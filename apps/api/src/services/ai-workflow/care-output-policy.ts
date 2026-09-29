const unsafeCareOutputPatterns = [
  /(?:焦虑症|抑郁症|心理疾病|心理障碍|精神疾病|anxiety disorder|depressive disorder|mental illness)/iu,
  /(?:我|系统|平台|学伴|AI|模型).{0,12}(?:判断|诊断|识别|检测|推断|确定).{0,18}(?:焦虑|抑郁|疲劳|崩溃|心理状态|精神状态|burnout|anxiety|depression)/iu,
  /(?:你|学生).{0,12}(?:患有|得了|确诊为|属于|存在|表现出|处于).{0,12}(?:焦虑|抑郁|疲劳|崩溃|心理问题|精神问题)/iu,
  /(?:绝对|完全|百分之百|100\s*%|永远).{0,8}(?:保密|不泄露|保护隐私|confidential)/iu,
  /(?:不会|绝不|永不).{0,12}(?:告诉|透露|分享|泄露).{0,12}(?:任何人|别人|老师|家长|学校|第三方)/iu,
  /(?:only between us|strictly confidential|completely confidential|absolutely confidential|won't tell anyone|will not tell anyone)/iu,
  /(?:我|系统|平台|学伴).{0,8}(?:已(?:经)?|将|会|帮你|替你).{0,14}(?:成绩|分数|得分|掌握度|能力分|错题|学习证据|学习记录|任务状态|完成状态|复习日期|学习计划).{0,10}(?:修改|更改|调整|更新|重置|调低|调高|降低|提高|增加|减少|删除|清除|标记|改成|改为|设为|设置)/iu,
  /(?:已(?:经)?|将|会|帮你|替你).{0,8}(?:修改|更改|调整|更新|重置|调低|调高|降低|提高|增加|减少|删除|清除|标记|改成|改为|设为|设置).{0,14}(?:成绩|分数|得分|掌握度|能力分|错题|学习证据|学习记录|任务状态|完成状态|复习日期|学习计划)/iu,
  /(?:成绩|分数|得分|掌握度|能力分|错题|学习证据|学习记录|任务状态|完成状态|复习日期|学习计划).{0,10}(?:已(?:经)?|将|会).{0,6}(?:被)?(?:修改|更改|调整|更新|重置|调低|调高|降低|提高|增加|减少|删除|清除|标记|改成|改为|设为|设置)/iu,
  /(?:我|系统|平台|学伴).{0,10}(?:已(?:经)?|将|会|帮你|替你).{0,8}(?:完成|提交|通过).{0,8}(?:任务|练习|复习|测验)/iu,
  /(?:保证|一定|肯定|确保|承诺).{0,14}(?:治愈|治疗|康复|缓解|考上|上岸|通过考试|提高成绩|提升分数)/iu,
] as const;

export function careOutputIsSafe(parts: readonly (string | null | undefined)[]) {
  const content = parts.filter((part): part is string => typeof part === "string").join("\n");
  return unsafeCareOutputPatterns.every((pattern) => !pattern.test(content));
}

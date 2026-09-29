export type AgentContext = "study" | "lab" | "teacher";

/** 按路由上下文分发的快捷提问：首页/课程中枢共用学习组，3D 沙盒与教师中枢各有专属组。 */
export const QUICK_PROMPTS: Record<AgentContext, string[]> = {
  study: [
    "TCP 传输层与网络层有什么区别？",
    "今天该优先复习哪一科？",
  ],
  lab: [
    "默认网关 192.168.10.99 为什么会导致 ARP 失败？",
    "如何用 ICMP 逐跳定位网络故障？",
  ],
  teacher: [
    "班上 HTTP 错题高发，怎么设计课堂讲评？",
    "帮我起草一份 TCP 重传的课堂干预教案",
  ],
};

export function agentContextForPath(path: string): AgentContext {
  if (path === "/teacher" || path.startsWith("/teacher/")) return "teacher";
  if (path.startsWith("/student/programming-experiments")) return "lab";
  return "study";
}

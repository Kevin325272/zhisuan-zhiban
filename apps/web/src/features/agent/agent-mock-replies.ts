import type { AgentContext } from "./agent-quick-prompts";

const ARP_REPLY = [
  "当主机把默认网关设为 192.168.10.99 时，发出数据包前会先在本网段广播 ARP 请求，询问「谁有 192.168.10.99 的 MAC 地址」。",
  "如果该地址在局域网内并不存在（比如网关真实地址是 192.168.10.1），就不会有设备应答，主机拿不到下一跳的 MAC，帧无法封装，于是表现为「请求超时」。",
  "在 3D 沙盒里可以对比：把网关改回 192.168.10.1 后 ARP 立即成功。这类「IP 可达但二层不通」正是 408 组网题的常考场景。",
].join("");

const ICMP_REPLY = [
  "逐跳定位的思路是让 TTL 从 1 开始递增：每经过一台路由器 TTL 减 1，减到 0 时路由器丢弃分组并回送 ICMP 超时报文（类型 11）。",
  "依次发送 TTL=1、2、3… 的分组，就能收到沿途每一跳的回应地址，直到目标返回端口不可达（类型 3）为止。",
  "Windows 对应 tracert，Linux 对应 traceroute。答题时注意：ICMP 超时报文里携带的是被丢弃分组的 IP 首部前 8 字节。",
].join("");

const HTTP_REPLY = [
  "HTTP 错题高频区通常集中在三类：状态码语义（301/302 与 304 的区分、401 与 403）、请求报文格式（Host 字段、Connection 头），以及 HTTP/1.1 持久连接与流水线。",
  "课堂讲评建议先用真题锚点引出典型错误选项，再让同学当场辨析「304 为什么没有响应体」「Location 头与 301 的配合」，最后用 3 道变式题做即时反馈。",
].join("");

const TCP_PLAN_REPLY = [
  "TCP 重传干预教案草稿：",
  "一、导入（5 分钟）：给出同一报文段超时未确认的抓包截图，提问「发送方会等多久」。",
  "二、核心机制（15 分钟）：RTO 的指数退避、快速重传的 3 个冗余 ACK 触发条件、与快恢复的联动。",
  "三、分组活动（15 分钟）：两组同学分别扮演发送方与接收方，模拟丢包与 ACK 乱序。",
  "四、收尾（5 分钟）：对比超时重传与快速重传的开销差异，布置一道综合题。",
  "重点提示：RTT 估值公式 RTTs = (1-α)×RTTs + α×新样本。",
].join("\n");

const LAYER_REPLY = [
  "网络层（IP）负责主机到主机的「尽力交付」，按目的 IP 选路，不保证可靠；",
  "传输层（TCP/UDP）负责端到端的进程间通信：TCP 在不可靠的网络层之上通过确认、重传、序号和流量控制提供可靠字节流，UDP 只提供复用与校验。",
  "一句话记忆：网络层管「送到哪台机器」，传输层管「交给哪个进程、按什么约定送」。",
  "408 常考两者的配合——比如 TCP 报文段如何封装进 IP 分组，以及拥塞控制为什么放在传输层而不是网络层。",
].join("");

const REVIEW_REPLY = [
  "今天的优先级建议：先处理「优先处理」科目的待复习错题（间隔到期的最先做），",
  "再用 15-20 分钟走一遍薄弱知识点对应的课程讲解，最后留一组新题验证掌握。",
  "如果时间少于 30 分钟，只做错题回访；时间充裕再进入四科中枢的「启动具身研学」。",
  "记忆类内容建议交给记忆卡按艾宾浩斯间隔复习。",
].join("");

const STUDY_FALLBACK = [
  "我已收到你的问题。作为 408 垂类学习 Agent，建议把它拆成「概念定义 → 典型场景 → 真题考法」三步梳理；",
  "也可以点击四科中枢里的对应课程，进入具身研学做一轮针对性练习。需要的话，把题目原文贴给我，我们一起分析选项。",
].join("");

const LAB_FALLBACK = [
  "收到。3D 具身仿真沙盒里的每个实验都对应一组 408 考点：先读实验目标，再操作拓扑，最后对照「现象 → 协议机制 → 真题」复盘。",
  "告诉我你正在做哪个实验，我可以带你一步步分析。",
].join("");

const TEACHER_FALLBACK = [
  "收到。作为教研决策 Agent，我可以从班级学情数据出发给出建议：先定位这道题涉及的知识点与班级错误分布，",
  "再决定是「课堂重点讲解」还是「个体干预」。你可以把题目或班级数据贴给我。",
].join("");

/** 本地模拟回复：按上下文与提问关键词返回预写话术。真实 API 接入时替换为流式服务即可。 */
export function mockReplyFor(context: AgentContext, userText: string): string {
  if (/192\.168\.10\.99|ARP|默认网关/.test(userText)) return ARP_REPLY;
  if (/ICMP|逐跳|tracert|traceroute/.test(userText)) return ICMP_REPLY;
  if (/HTTP/.test(userText) && /错题|讲评/.test(userText)) return HTTP_REPLY;
  if (/TCP/.test(userText) && /重传|教案/.test(userText)) return TCP_PLAN_REPLY;
  if (/传输层|网络层/.test(userText)) return LAYER_REPLY;
  if (/复习|优先|今天/.test(userText)) return REVIEW_REPLY;
  if (context === "lab") return LAB_FALLBACK;
  if (context === "teacher") return TEACHER_FALLBACK;
  return STUDY_FALLBACK;
}

export interface StreamSignal {
  cancelled: boolean;
}

/**
 * 本地模拟流式输出：按固定节拍分块派发文本。
 * prefers-reduced-motion 为 true 时一次性输出全部内容。
 * 真实 API 接入位：将本函数替换为 SSE 流式读取（参考 api/client.ts 的 readSseStream 模式）。
 */
export function streamMockReply(
  fullText: string,
  onDelta: (chunk: string) => void,
  signal: StreamSignal,
): Promise<void> {
  return new Promise((resolve) => {
    const mediaQuery = typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)")
      : null;
    if (mediaQuery?.matches) {
      onDelta(fullText);
      resolve();
      return;
    }
    const chunkSize = 3;
    let cursor = 0;
    const timer = window.setInterval(() => {
      if (signal.cancelled) {
        window.clearInterval(timer);
        resolve();
        return;
      }
      const next = fullText.slice(cursor, cursor + chunkSize);
      cursor += chunkSize;
      if (next) onDelta(next);
      if (cursor >= fullText.length) {
        window.clearInterval(timer);
        resolve();
      }
    }, 30);
  });
}

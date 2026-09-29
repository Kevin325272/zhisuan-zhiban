import type { CourseId, LabDefinition, LabField, LabInputs } from "./types";

export const COURSES: { id: CourseId; name: string; short: string; description: string }[] = [
  { id: "computer-networks", name: "计算机网络", short: "CN", description: "连接设备，追踪每一次通信" },
  { id: "computer-organization", name: "计算机组成原理", short: "CO", description: "沿着数据，走进计算机内部" },
  { id: "operating-systems", name: "操作系统", short: "OS", description: "分配资源，观察系统如何决策" },
];
export const PORTS = ["pc-a:eth0", "sw-a:1", "sw-a:2", "sw-a:3", "router:ge0", "router:ge1", "sw-b:1", "sw-b:2", "pc-b:eth0"];
export const ROUTED_LINKS = "pc-a:eth0~sw-a:1|sw-a:2~router:ge0|router:ge1~sw-b:1|sw-b:2~pc-b:eth0";
export const LOCAL_LINKS = "pc-a:eth0~sw-a:1|sw-a:2~pc-b:eth0";
const field = (key: string, label: string, value: string, rest: Partial<LabField> = {}): LabField => ({ key, label, value, ...rest });
const num = (key: string, label: string, value: string, min: number, max: number) => field(key, label, value, { type: "number", min, max });
const select = (key: string, label: string, value: string, options: string[]) => field(key, label, value, { type: "select", options });
const networkFields = (local = false): LabField[] => [
  field("srcIp", "主机 A · IP 地址", "192.168.10.10", { device: "pc-a" }),
  field("srcMask", "主机 A · 子网掩码", "255.255.255.0", { device: "pc-a" }),
  field("srcGateway", "主机 A · 默认网关", "192.168.10.1", { device: "pc-a" }),
  field("dstIp", "主机 B · IP 地址", local ? "192.168.10.20" : "192.168.20.20", { device: "pc-b" }),
  field("dstMask", "主机 B · 子网掩码", "255.255.255.0", { device: "pc-b" }),
  field("dstGateway", "主机 B · 默认网关", "192.168.20.1", { device: "pc-b" }),
  field("routerA", "GE0 · 接口地址", "192.168.10.1", { device: "router" }),
  field("routerB", "GE1 · 接口地址", "192.168.20.1", { device: "router" }),
  field("routerMaskA", "GE0 · 子网掩码", "255.255.255.0", { device: "router" }),
  field("routerMaskB", "GE1 · 子网掩码", "255.255.255.0", { device: "router" }),
];
export const LABS: LabDefinition[] = [
  { id: "network-routing", course: "computer-networks", title: "跨网段通信", description: "搭建两个子网，定位一次通信故障。", task: "让主机 A 的 ICMP 请求穿过路由器，到达主机 B 并收到应答。", duration: "15–20 分钟", concepts: ["IPv4", "ARP", "ICMP", "直连路由"], fields: networkFields() },
  { id: "network-arp", course: "computer-networks", title: "局域网交换与 ARP", description: "从一次广播开始，观察交换机的学习过程。", task: "连接同一子网中的两台主机，观察 ARP 解析与 MAC 地址学习。", duration: "10–15 分钟", concepts: ["广播域", "MAC 表", "ARP"], fields: networkFields(true) },
  { id: "network-tcp", course: "computer-networks", title: "TCP 连接与可靠传输", description: "建立连接，观察丢包之后的重传。", task: "完成三次握手与分段传输，改变丢失的段，检查序号与累计确认。", duration: "15–20 分钟", concepts: ["三次握手", "序号", "停止等待重传"], fields: [...networkFields(), num("clientSeq", "客户端初始序号", "100", 0, 1000000), num("serverSeq", "服务端初始序号", "500", 0, 1000000), num("payload", "发送字节数", "2400", 1, 12000), num("mss", "每段最多字节", "800", 100, 2000), num("loss", "丢失第几段（0 不丢失）", "2", 0, 120)] },
  { id: "network-dns", course: "computer-networks", title: "DNS 解析与 HTTP 请求", description: "追踪从域名查询到网页响应的全过程。", task: "查询教学域名，使用返回的 IPv4 地址访问主机 B 的 HTTP 服务。", duration: "15–20 分钟", concepts: ["DNS A 记录", "TCP", "HTTP/1.1"], fields: [...networkFields(), field("domain", "查询域名", "learn.lab"), field("recordName", "DNS 记录名称", "learn.lab"), field("recordIp", "DNS 记录地址", "192.168.20.20"), select("http", "HTTP 服务", "开启", ["开启", "关闭"])] },
  { id: "co-cache", course: "computer-organization", title: "Cache 映射与替换", description: "改变访问顺序，观察命中与冲突。", task: "逐次访问主存地址，对比直接映射与组相联下的命中、替换与平均访问时间。", duration: "15–20 分钟", concepts: ["地址划分", "组相联", "FIFO / LRU"], fields: [field("addresses", "字节地址序列", "0, 4, 0, 16, 0, 4, 32, 0", { type: "textarea", hint: "以逗号或空格分隔，支持 0x 十六进制" }), select("lines", "Cache 总行数", "4", ["4", "8"]), select("ways", "每组路数", "1", ["1", "2", "4"]), select("block", "块大小（字节）", "4", ["4", "8", "16"]), select("policy", "替换策略", "LRU", ["LRU", "FIFO"]), num("hitTime", "命中时间（ns）", "1", 1, 100), num("penalty", "未命中额外开销（ns）", "50", 1, 1000)] },
  { id: "co-instruction", course: "computer-organization", title: "指令执行与数据通路", description: "从取指到写回，跟随一条指令。", task: "设置两个 16 位操作数和运算指令，追踪寄存器、控制器与 ALU 的数据流。", duration: "10–15 分钟", concepts: ["取指", "译码", "ALU", "寄存器写回"], fields: [select("operation", "指令", "ADD", ["ADD", "SUB", "AND", "OR"]), num("a", "R1 初值（无符号 16 位）", "42", 0, 65535), num("b", "R2 初值（无符号 16 位）", "18", 0, 65535)] },
  { id: "co-pipeline", course: "computer-organization", title: "五级流水线与冒险", description: "让多条指令重叠执行，观察停顿如何产生。", task: "输入寄存器依赖，启用或关闭前递，比较这组 ALU 指令的执行周期。", duration: "15–20 分钟", concepts: ["IF / ID / EX / MEM / WB", "RAW 冒险", "前递"], fields: [field("instructions", "ALU 指令（目标,源1,源2）", "R1,R2,R3\nR4,R1,R5\nR6,R4,R1\nR7,R2,R3", { type: "textarea", hint: "每行一条 ADD；R0 恒为零，最多 8 条；WB 前半周期写回，ID 后半周期读取" }), select("forwarding", "EX 结果前递", "开启", ["开启", "关闭"])] },
  { id: "co-io", course: "computer-organization", title: "中断与 DMA", description: "把一段数据搬入内存，比较 CPU 的参与方式。", task: "比较逐字中断搬运与一次 DMA 块传输，统计 CPU 占用周期。", duration: "10–15 分钟", concepts: ["中断响应", "DMA", "总线占用"], fields: [num("words", "传输字数", "8", 1, 32), select("mode", "传输方式", "DMA", ["DMA", "逐字中断"]), num("service", "每次中断服务开销（周期）", "6", 1, 30), num("setup", "DMA 初始化开销（周期）", "4", 1, 30)] },
  { id: "os-pages", course: "operating-systems", title: "页面置换", description: "有限页框中，每次替换都有依据。", task: "输入页面引用序列，比较 FIFO 和 LRU 的缺页情况，回看被换出的页面。", duration: "15–20 分钟", concepts: ["页框", "缺页", "FIFO / LRU"], fields: [field("references", "页面引用序列", "7, 0, 1, 2, 0, 3, 0, 4, 2, 3, 0, 3, 2", { type: "textarea" }), num("frames", "可用页框数", "3", 1, 8), select("policy", "置换算法", "LRU", ["LRU", "FIFO"])] },
  { id: "os-scheduling", course: "operating-systems", title: "进程调度", description: "安排 CPU 时间，观察等待与周转。", task: "为进程设置到达和运行时间，比较不同算法的执行顺序与等待时间。", duration: "15–20 分钟", concepts: ["FCFS", "非抢占 SJF", "时间片轮转"], fields: [field("processes", "进程（到达时间,运行时间）", "0,5\n1,3\n2,1", { type: "textarea", hint: "每行一个进程，按顺序命名 P1、P2…；时间单位为 ms" }), select("policy", "调度算法", "RR", ["FCFS", "SJF", "RR"]), num("quantum", "时间片（ms）", "2", 1, 20)] },
  { id: "os-deadlock", course: "operating-systems", title: "死锁与资源分配", description: "请求资源之前，先寻找安全执行顺序。", task: "修改单类可复用资源的分配与最大需求，运行银行家安全性检查。", duration: "10–15 分钟", concepts: ["最大需求", "安全序列", "不安全状态"], fields: [field("allocations", "已分配资源（各进程）", "1, 2, 1"), field("maximums", "最大需求（各进程）", "3, 4, 2"), num("available", "当前可用资源", "1", 0, 100)] },
  { id: "os-disk", course: "operating-systems", title: "磁盘调度", description: "跟随磁头移动，比较寻道路径。", task: "设置磁道请求和起始位置，比较 FCFS、SSTF、SCAN 的移动距离。", duration: "10–15 分钟", concepts: ["磁道", "寻道距离", "扫描方向"], fields: [field("requests", "磁道请求序列", "98,183,37,122,14,124,65,67", { type: "textarea" }), num("head", "初始磁道", "53", 0, 199), select("policy", "磁盘调度算法", "SSTF", ["FCFS", "SSTF", "SCAN"]), select("direction", "SCAN 初始方向", "向高磁道", ["向高磁道", "向低磁道"])] },
];
export function defaultsFor(lab: LabDefinition): LabInputs {
  return { ...Object.fromEntries(lab.fields.map((f) => [f.key, f.value])), ...(lab.course === "computer-networks" ? { links: lab.id === "network-arp" ? LOCAL_LINKS : ROUTED_LINKS } : {}) };
}
export function findLab(id: string | undefined) {
  const alias: Record<string, string> = { "computer-networks": "network-routing", "computer-organization": "co-cache", "operating-systems": "os-pages" };
  return LABS.find((lab) => lab.id === (alias[id ?? ""] ?? id));
}

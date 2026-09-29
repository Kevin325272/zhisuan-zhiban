import { PORTS } from "./lab-catalog";
import type { LabCell, LabDefinition, LabEvent, LabInputs, LabRun, Metric } from "./types";

const metrics = (values: Record<string, string | number>): Metric[] => Object.entries(values).map(([label, value]) => ({ label, value: String(value) }));
function trace() {
  const events: LabEvent[] = [];
  return {
    events,
    add(title: string, detail: string, active: string[], values: Record<string, string | number> = {}, extra: Partial<LabEvent> = {}) {
      events.push(structuredClone({ title, detail, active, metrics: metrics(values), ...extra }));
    },
    finish(summary: string, values: Record<string, string | number>, status: LabRun["status"] = "success"): LabRun {
      return { status, summary, metrics: metrics(values), events };
    },
  };
}
function integer(text: string | undefined, label: string, min = 0, max = 65535) {
  if (!text?.trim() || !/^(?:\d+|0x[\da-f]+)$/iu.test(text.trim())) throw new Error(`${label}须填写整数`);
  const n = Number(text);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`${label}范围为 ${min}–${max}`);
  return n;
}
function sequence(text: string | undefined, label: string, max = 65535, count = 64): number[] {
  const tokens = (text ?? "").trim().split(/[\s,，]+/u);
  if (!tokens[0] || tokens.length > count) throw new Error(`${label}需包含 1–${count} 个数`);
  return tokens.map((token) => integer(token, label, 0, max));
}
function ipv4(text: string | undefined) {
  if (!text || !/^\d{1,3}(\.\d{1,3}){3}$/u.test(text)) throw new Error("IP 地址或掩码须为有效的 IPv4 格式");
  return text.split(".").reduce((value, octet) => value * 256 + integer(octet, "IPv4 分段", 0, 255), 0) >>> 0;
}
function mask(text: string | undefined) {
  const value = ipv4(text);
  const inverse = (~value) >>> 0;
  if ((inverse & (inverse + 1)) !== 0 || inverse < 3 || value === 0) throw new Error("子网掩码必须连续，本实验支持 /1 至 /30");
  return value;
}
const subnet = (a: number, b: number, m: number) => ((a & m) >>> 0) === ((b & m) >>> 0);
export function parseLinks(value: string): [string, string][] {
  if (!value) return [];
  const occupied = new Set<string>();
  return value.split("|").map((link) => {
    const pair = link.split("~");
    const a = pair[0] ?? ""; const b = pair[1] ?? "";
    if (pair.length !== 2 || !PORTS.includes(a) || !PORTS.includes(b) || a.split(":")[0] === b.split(":")[0]) throw new Error("连接须选择两台设备上的有效端口");
    if (occupied.has(a) || occupied.has(b)) throw new Error("一个端口只能连接一根网线");
    occupied.add(a); occupied.add(b);
    return [a, b];
  });
}
const deviceOf = (port: string) => port.split(":")[0]!;

function network(lab: LabDefinition, input: LabInputs): LabRun {
  const t = trace();
  const ip = { a: ipv4(input.srcIp), b: ipv4(input.dstIp), r0: ipv4(input.routerA), r1: ipv4(input.routerB) };
  const masks = { a: mask(input.srcMask), b: mask(input.dstMask), r0: mask(input.routerMaskA), r1: mask(input.routerMaskB) };
  const gateways = { a: ipv4(input.srcGateway), b: ipv4(input.dstGateway) };
  for (const id of ["a", "b", "r0", "r1"] as const) {
    const hostPart = (ip[id] & ~masks[id]) >>> 0;
    if (hostPart === 0 || hostPart === ((~masks[id]) >>> 0)) throw new Error("设备地址不能使用所在子网的网络地址或广播地址");
  }
  if (new Set(Object.values(ip)).size !== 4) throw new Error("设备 IP 地址不能重复");
  const links = parseLinks(input.links ?? "");
  const graph = new Map<string, string[]>();
  const edge = (a: string, b: string) => { graph.set(a, [...(graph.get(a) ?? []), b]); graph.set(b, [...(graph.get(b) ?? []), a]); };
  links.forEach(([a, b]) => edge(a, b));
  for (const sw of ["sw-a", "sw-b"]) {
    const ports = PORTS.filter((p) => p.startsWith(`${sw}:`));
    ports.forEach((a, i) => ports.slice(i + 1).forEach((b) => edge(a, b)));
  }
  function path(a: string, b: string): string[] | undefined {
    const queue: string[][] = [[a]]; const visited = new Set([a]);
    for (let i = 0; i < queue.length; i++) {
      const route = queue[i]!; const last = route.at(-1)!;
      if (last === b) return route.map(deviceOf).filter((d, k, all) => d !== all[k - 1]);
      for (const next of graph.get(last) ?? []) if (!visited.has(next)) { visited.add(next); queue.push([...route, next]); }
    }
    return undefined;
  }
  const fail = (reason: string, active: string[]) => {
    t.add("通信中止", reason, active, { "通信结果": "未连通" });
    return t.finish(reason, { "通信结果": "未连通" }, "blocked");
  };
  t.add("读取设备与连接", `本次连接 ${links.length} 根网线，检查主机地址、子网与下一跳。`, ["pc-a", "pc-b"], { "连接数": links.length });
  function deliver(from: "a" | "b", to: "a" | "b", reply: boolean): { route: string[] } | { error: string; active: string[] } {
    const source = from === "a" ? "pc-a" : "pc-b";
    const target = to === "a" ? "pc-a" : "pc-b";
    const sourceIp = from === "a" ? input.srcIp! : input.dstIp!;
    const targetIp = to === "a" ? input.srcIp! : input.dstIp!;
    let route: string[];
    if (subnet(ip[from], ip[to], masks[from])) {
      const direct = path(`${source}:eth0`, `${target}:eth0`);
      t.add("ARP · 查询目标 MAC", `${sourceIp} 判断 ${targetIp} 位于本地子网，广播查询目标 MAC。交换机学习入端口的源 MAC。`, [source, "sw-a"], { "下一跳": targetIp });
      if (!direct) return { error: "ARP 无响应：目标虽然在本地子网，但没有连通的二层路径。检查网线与交换机端口。", active: [source] };
      route = direct;
      t.add("ARP · 应答与地址学习", `目标返回 MAC，交换机学习反向端口，后续帧可沿已学习的端口转发。`, [target], { "解析结果": "已解析" }, { path: [...route].reverse() });
    } else {
      const gateway = from === "a" ? input.srcGateway! : input.dstGateway!;
      t.add("选择默认网关", `${sourceIp} 与 ${targetIp} 不在同一子网，下一跳为 ${gateway}。`, [source], { "下一跳": gateway });
      if (!subnet(ip[from], gateways[from], masks[from])) return { error: `${source} 的默认网关 ${gateway} 不在本地主机子网，无法作为下一跳。`, active: [source] };
      const ingress = gateways[from] === ip.r0 ? "r0" : gateways[from] === ip.r1 ? "r1" : undefined;
      if (!ingress) return { error: `ARP 解析失败：默认网关 ${gateway} 没有对应的路由器接口。`, active: [source] };
      const ingressPort = ingress === "r0" ? "router:ge0" : "router:ge1";
      const first = path(`${source}:eth0`, ingressPort);
      if (!first) return { error: "ARP 解析失败：通往默认网关的网线未连通。", active: [source] };
      t.add("ARP · 解析网关", `网关 ${gateway} 返回接口 MAC。主机封装以太网帧，IP 目标仍是 ${targetIp}。`, first, { "网关 MAC": ingress === "r0" ? "02:00:00:00:01:01" : "02:00:00:00:02:01" }, { path: first });
      const candidates = (["r0", "r1"] as const).filter((r) => subnet(ip[to], ip[r], masks[r])).sort((a, b) => masks[b] - masks[a]);
      const egress = candidates[0];
      if (!egress) return { error: `路由器没有匹配 ${targetIp} 的直连路由。`, active: ["router"] };
      const second = path(egress === "r0" ? "router:ge0" : "router:ge1", `${target}:eth0`);
      t.add("查找直连路由", `最长前缀匹配选择 ${egress === "r0" ? "GE0" : "GE1"}，转发时 TTL 从 64 减至 63。`, ["router"], { "出接口": egress === "r0" ? "GE0" : "GE1", "TTL": 63 });
      if (!second) return { error: "目标侧 ARP 无响应：路由器到目标主机的二层路径未连通。", active: ["router"] };
      t.add("目标侧地址解析", `路由器通过 ARP 获得 ${targetIp} 的 MAC，重新封装以太网帧。`, second, { "下一跳": targetIp }, { path: second });
      route = [...first, ...second.slice(1)];
    }
    t.add(reply ? "收到 ICMP 应答" : "ICMP 请求到达", `${sourceIp} → ${targetIp}，${reply ? "应答到达，往返连通" : "目标主机收到请求，准备沿自己的路由返回"}。`, [target], { "通信结果": reply ? "已连通" : "请求已到达" }, { path: route });
    return { route };
  }
  const outward = deliver("a", "b", false);
  if ("error" in outward) return fail(outward.error, outward.active);
  const inward = deliver("b", "a", true);
  if ("error" in inward) return fail(inward.error, inward.active);
  if (lab.id === "network-tcp" || lab.id === "network-dns") {
    const clientSeq = lab.id === "network-tcp" ? Number(input.clientSeq) : 100;
    const serverSeq = lab.id === "network-tcp" ? Number(input.serverSeq) : 500;
    if (lab.id === "network-dns") {
      const name = (input.domain ?? "").toLowerCase().replace(/\.$/u, "");
      const record = (input.recordName ?? "").toLowerCase().replace(/\.$/u, "");
      if (!/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/u.test(name) || !record) throw new Error("请填写有效的教学域名");
      ipv4(input.recordIp);
      t.add("DNS · 查询 A 记录", `向主机 B 的教学 DNS 服务查询 ${name}。`, ["pc-a", "pc-b"], { "查询类型": "A" }, { path: outward.route });
      if (name !== record) return fail(`NXDOMAIN：DNS 中没有 ${name} 的记录。`, ["pc-b"]);
      t.add("DNS · 返回地址", `${name} → ${input.recordIp}`, ["pc-b"], { "解析地址": input.recordIp! }, { path: inward.route });
      if (input.recordIp !== input.dstIp) return fail("解析地址不对应本实验的主机 B，请修正 A 记录后重试。", ["pc-a"]);
      if (input.http === "关闭") return fail("主机 B 的 HTTP 服务关闭，TCP 80 端口拒绝连接。", ["pc-b"]);
    }
    t.add("TCP · SYN", `客户端发送 SYN，seq=${clientSeq}。SYN 占用一个序号。`, ["pc-a"], { "客户端状态": "SYN-SENT" }, { path: outward.route });
    t.add("TCP · SYN + ACK", `服务端 seq=${serverSeq}，ack=${clientSeq + 1}。`, ["pc-b"], { "服务端状态": "SYN-RECEIVED" }, { path: inward.route });
    t.add("TCP · ACK", `客户端 seq=${clientSeq + 1}，ack=${serverSeq + 1}，双方进入 ESTABLISHED。`, ["pc-a", "pc-b"], { "连接状态": "ESTABLISHED" }, { path: outward.route });
    if (lab.id === "network-dns") {
      t.add("HTTP · GET /", `通过已建立的连接发送 GET / HTTP/1.1，Host: ${input.domain}。`, ["pc-a"], { "请求方法": "GET" }, { path: outward.route });
      t.add("HTTP · 200 OK", "主机 B 返回教学页面响应，请求完成。", ["pc-b"], { "HTTP 状态": "200 OK", "DNS 查询": 1 }, { path: inward.route });
      return t.finish("域名解析与 HTTP 请求完成", { "HTTP 状态": "200 OK", "DNS 查询": 1 });
    }
    const size = Number(input.payload); const mss = Number(input.mss); const loss = Number(input.loss);
    const count = Math.ceil(size / mss);
    if (loss > count) throw new Error(`本次只有 ${count} 个数据段，丢失段号须在 0–${count} 之间`);
    let offset = 0;
    for (let segment = 1; segment <= count; segment++) {
      const bytes = Math.min(mss, size - offset);
      const seq = clientSeq + 1 + offset;
      t.add(`发送数据段 ${segment}`, `seq=${seq}，长度 ${bytes} 字节；采用停止等待模型观察确认与重传。`, ["pc-a"], { "当前序号": seq, "段长度": `${bytes} B` }, { path: outward.route });
      if (segment === loss) {
        t.add("分组丢失 · 等待超时", `第 ${segment} 段被丢弃，接收方尚未确认这段数据。`, ["router"], { "重传段数": 0 });
        t.add("超时重传", `重发相同 seq=${seq} 的 ${bytes} 字节，序号不会重新分配。`, ["pc-a"], { "重传段数": 1 }, { path: outward.route });
      }
      offset += bytes;
      t.add(`累计确认 ${clientSeq + 1 + offset}`, `接收方下一期待字节为 ${clientSeq + 1 + offset}。`, ["pc-b"], { "已确认字节": offset, "确认号": clientSeq + 1 + offset }, { path: inward.route });
    }
    return t.finish("所有数据字节已获确认", { "最终确认号": clientSeq + 1 + size, "重传段数": loss ? 1 : 0, "发送数据段": count });
  }
  return t.finish("ICMP 往返通信成功", { "通信结果": "已连通", "路由转发": outward.route.includes("router") ? "1 跳" : "同一子网" });
}

function cache(input: LabInputs) {
  const t = trace(); const addresses = sequence(input.addresses, "地址序列");
  const lines = Number(input.lines); const ways = Number(input.ways); const block = Number(input.block); const sets = lines / ways;
  const bank: { block: number; born: number; used: number }[][] = Array.from({ length: sets }, () => []);
  let hits = 0;
  t.add("Cache 初始为空", `${sets} 组 × ${ways} 路，每块 ${block} 字节，替换策略 ${input.policy}。`, ["cache"], { "命中次数": 0, "未命中次数": 0 });
  addresses.forEach((address, i) => {
    const blockNo = Math.floor(address / block); const set = blockNo % sets; const tag = Math.floor(blockNo / sets); const slots = bank[set]!;
    const hit = slots.find((slot) => slot.block === blockNo); let removed: number | undefined;
    if (hit) { hits++; hit.used = i; } else {
      if (slots.length === ways) {
        const victim = slots.reduce((a, b) => (input.policy === "LRU" ? a.used < b.used : a.born < b.born) ? a : b);
        removed = victim.block; slots[slots.indexOf(victim)] = { block: blockNo, born: i, used: i };
      } else slots.push({ block: blockNo, born: i, used: i });
    }
    const cells: LabCell[] = bank.flatMap((group, groupNo) => Array.from({ length: ways }, (_, way) => ({ label: `组 ${groupNo} / 路 ${way}`, value: group[way] ? `块 ${group[way]!.block}` : "空", ...(groupNo === set ? { state: hit ? "hit" as const : "miss" as const } : {}) })));
    t.add(`访问 ${address} · ${hit ? "命中" : "未命中"}`, `块号 ${blockNo}，组索引 ${set}，Tag ${tag}，块内偏移 ${address % block}。${removed !== undefined ? `换出块 ${removed}。` : ""}${hit ? "直接从 Cache 返回。" : "从主存调入对应块。"}`, hit ? ["cpu", "cache"] : ["cpu", "cache", "ram"], { "命中次数": hits, "未命中次数": i + 1 - hits }, { cells, path: hit ? ["cpu", "cache", "cpu"] : ["cpu", "cache", "ram", "cache", "cpu"] });
  });
  const misses = addresses.length - hits;
  return t.finish("访存序列执行完成", { "命中次数": hits, "未命中次数": misses, "命中率": `${(hits / addresses.length * 100).toFixed(1)}%`, "平均访问时间": `${(Number(input.hitTime) + misses / addresses.length * Number(input.penalty)).toFixed(2)} ns` });
}
function pages(input: LabInputs) {
  const t = trace(); const refs = sequence(input.references, "页面序列", 255); const capacity = Number(input.frames);
  const frames: { page: number; born: number; used: number }[] = []; let faults = 0;
  t.add("初始化页框", `${capacity} 个空页框，采用 ${input.policy}。`, ["ram"], { "缺页次数": 0 });
  refs.forEach((page, i) => {
    const hit = frames.find((f) => f.page === page); let replaced: number | undefined;
    if (hit) hit.used = i;
    else {
      faults++;
      const next = { page, born: i, used: i };
      if (frames.length < capacity) frames.push(next);
      else {
        const victim = frames.reduce((a, b) => (input.policy === "LRU" ? a.used < b.used : a.born < b.born) ? a : b);
        replaced = victim.page; frames[frames.indexOf(victim)] = next;
      }
    }
    const cells: LabCell[] = Array.from({ length: capacity }, (_, k) => ({ label: `页框 ${k}`, value: frames[k] ? `页 ${frames[k]!.page}` : "空", ...(frames[k]?.page === page ? { state: hit ? "hit" as const : "miss" as const } : {}) }));
    t.add(`引用页 ${page} · ${hit ? "命中" : "缺页"}`, hit ? `页面已在主存中。${input.policy === "LRU" ? "更新最近使用次序。" : "FIFO 入队次序保持不变。"}` : `${replaced !== undefined ? `按 ${input.policy} 换出页 ${replaced}，` : "使用空闲页框，"}装入页 ${page}。`, hit ? ["cpu", "ram"] : ["cpu", "ram", "disk"], { "缺页次数": faults, "命中次数": i + 1 - faults }, { cells, path: hit ? ["cpu", "ram"] : ["disk", "ram", "cpu"] });
  });
  return t.finish("页面引用序列执行完成", { "缺页次数": faults, "命中次数": refs.length - faults, "缺页率": `${(faults / refs.length * 100).toFixed(1)}%` });
}
function instruction(input: LabInputs) {
  const t = trace(); const a = Number(input.a); const b = Number(input.b);
  const raw = input.operation === "ADD" ? a + b : input.operation === "SUB" ? a - b : input.operation === "AND" ? a & b : a | b;
  const result = raw & 65535;
  const cells = (r3: string): LabCell[] => [{ label: "R1", value: String(a) }, { label: "R2", value: String(b) }, { label: "R3", value: r3 }];
  t.add("取指 · IF", `PC 指向 ${input.operation} R3, R1, R2，从指令存储器读取到 IR。`, ["cpu", "ram"], { "IR": `${input.operation} R3,R1,R2` }, { path: ["ram", "cpu"], cells: cells("—") });
  t.add("译码 · ID", `控制器识别 ${input.operation}，读取 R1=${a}、R2=${b}。`, ["cpu"], { "R1": a, "R2": b }, { cells: cells("—") });
  t.add("执行 · EX", `ALU 完成 ${input.operation}，无符号 16 位结果为 ${result}。超出位宽时保留低 16 位。`, ["cpu"], { "ALU 结果": result }, { cells: cells("—") });
  t.add("访存 · MEM", "本条为寄存器算术/逻辑指令，经过 MEM 阶段但不读写数据内存。", ["cpu"], { "数据访存": "无" }, { cells: cells("—") });
  t.add("写回 · WB", `将结果 ${result} 写入 R3。`, ["cpu"], { "R3": result }, { cells: cells(String(result)) });
  return t.finish("指令执行完成", { "R3": result, "16 位十六进制": `0x${result.toString(16).toUpperCase().padStart(4, "0")}` });
}
function pipeline(input: LabInputs) {
  const t = trace(); const lines = (input.instructions ?? "").trim().split(/\n/u);
  if (!lines[0] || lines.length > 8) throw new Error("流水线需包含 1–8 条 ALU 指令");
  const program = lines.map((line) => {
    const parts = line.trim().toUpperCase().split(/[\s,，]+/u);
    if (parts.length !== 3 || parts.some((p) => !/^R(?:[0-9]|[12][0-9]|3[01])$/u.test(p))) throw new Error("每行填写三个 R0–R31 寄存器，例如 R1,R2,R3");
    return parts;
  });
  // In-order ALU-only pipeline: WB writes before ID reads in the same cycle.
  const schedules: number[][] = []; let previousDecode = 1;
  program.forEach((parts, i) => {
    let decode = Math.max(i + 2, previousDecode + 1);
    if (input.forwarding === "关闭") {
      for (const source of parts.slice(1)) {
        if (source === "R0") continue;
        for (let k = i - 1; k >= 0; k--) if (program[k]![0] === source) { decode = Math.max(decode, schedules[k]![4]!); break; }
      }
    }
    const fetch = i === 0 ? 1 : previousDecode;
    schedules.push([fetch, decode, decode + 1, decode + 2, decode + 3]); previousDecode = decode;
  });
  const total = schedules.at(-1)![4]!; const stages = ["IF", "ID", "EX", "MEM", "WB"];
  for (let cycle = 1; cycle <= total; cycle++) {
    const rows = program.map((p, i) => {
      const times = schedules[i]!; const stage = times.indexOf(cycle);
      const text = stage >= 0 ? stages[stage]! : cycle > times[0]! && cycle < times[1]! ? "等待 ID" : cycle > times[4]! ? "完成" : "—";
      return [`I${i + 1}`, `ADD ${p.join(", ")}`, text];
    });
    t.add(`周期 ${cycle}`, rows.filter((r) => !["—", "完成"].includes(r[2]!)).map((r) => `${r[0]}：${r[2]}`).join("；"), ["cpu"], { "当前周期": cycle, "前递": input.forwarding! }, { table: { columns: ["指令", "寄存器", "阶段"], rows } });
  }
  return t.finish("流水线执行完成", { "总周期": total, "停顿周期": total - program.length - 4, "CPI": (total / program.length).toFixed(2) });
}
function io(input: LabInputs) {
  const t = trace(); const count = Number(input.words); const setup = Number(input.setup); const service = Number(input.service); const dma = input.mode === "DMA";
  let cpu = dma ? setup : 0;
  t.add("初始化传输", dma ? `CPU 使用 ${setup} 周期配置 DMA 地址与字数。` : "设备每准备好一个字，向 CPU 发出一次中断。", ["cpu", "io"], { "CPU 占用周期": cpu });
  for (let word = 1; word <= count; word++) {
    if (!dma) cpu += service + 1;
    t.add(`传输第 ${word} 字`, dma ? "DMA 获得总线后将一字直接写入内存，占用一个总线周期。" : `中断服务 ${service} 周期，再由 CPU 搬运一字用 1 周期。`, dma ? ["io", "ram"] : ["io", "cpu", "ram"], { "已传输字数": word, "CPU 占用周期": cpu }, { path: dma ? ["io", "ram"] : ["io", "cpu", "ram"] });
  }
  if (dma) cpu += service;
  t.add("传输完成", dma ? `DMA 发出一次完成中断，CPU 服务开销 ${service} 周期。此模型不计总线争用造成的 CPU 等待。` : "最后一字已由中断处理程序搬入内存。", ["cpu", "ram"], { "CPU 占用周期": cpu });
  return t.finish("块传输完成", { "CPU 占用周期": cpu, "中断次数": dma ? 1 : count, "数据总线占用": `${count} 周期` });
}
function scheduling(input: LabInputs) {
  const t = trace(); const lines = (input.processes ?? "").trim().split(/\n/u);
  if (!lines[0] || lines.length > 8) throw new Error("请填写 1–8 个进程");
  const processes = lines.map((line, i) => {
    const parts = line.split(/[,，\s]+/u);
    if (parts.length !== 2) throw new Error("每行格式为 到达时间,运行时间");
    const arrival = integer(parts[0], "到达时间", 0, 100); const burst = integer(parts[1], "运行时间", 1, 30);
    return { id: `P${i + 1}`, arrival, burst, remain: burst, finish: 0, index: i };
  });
  const future = [...processes].sort((a, b) => a.arrival - b.arrival || a.index - b.index);
  const ready: typeof processes = []; let time = 0; let cursor = 0; let completed = 0;
  const enqueue = () => { while (cursor < future.length && future[cursor]!.arrival <= time) ready.push(future[cursor++]!); };
  t.add("建立进程队列", `${processes.length} 个进程，算法 ${input.policy}；上下文切换开销设为 0。`, ["cpu"], { "当前时刻": "0 ms" });
  while (completed < processes.length) {
    enqueue();
    if (!ready.length) {
      const nextTime = future[cursor]!.arrival;
      t.add("CPU 空闲", `${time}–${nextTime} ms 等待下一进程到达。`, [], { "当前时刻": `${nextTime} ms` }); time = nextTime; enqueue();
    }
    if (input.policy === "SJF") ready.sort((a, b) => a.burst - b.burst || a.arrival - b.arrival || a.index - b.index);
    const p = ready.shift()!; const slice = input.policy === "RR" ? Math.min(p.remain, Number(input.quantum)) : p.remain;
    const start = time; time += slice; p.remain -= slice; enqueue();
    if (!p.remain) { p.finish = time; completed++; } else ready.push(p);
    t.add(`${p.id} · ${start}–${time} ms`, `${p.remain ? `时间片用完，剩余 ${p.remain} ms，重新排到队尾。` : `${p.id} 完成。`}就绪队列：${ready.map((r) => r.id).join(" → ") || "空"}`, ["cpu"], { "当前时刻": `${time} ms`, "已完成进程": completed }, { cells: processes.map((p2) => ({ label: p2.id, value: p2.finish ? "已完成" : `${p2.remain} ms`, ...(p2 === p ? { state: "active" as const } : {}) })), table: { columns: ["进程", "到达", "剩余", "完成"], rows: processes.map((p2) => [p2.id, String(p2.arrival), String(p2.remain), p2.finish ? String(p2.finish) : "—"]) } });
  }
  const wait = processes.reduce((sum, p) => sum + p.finish - p.arrival - p.burst, 0) / processes.length;
  const turnaround = processes.reduce((sum, p) => sum + p.finish - p.arrival, 0) / processes.length;
  return t.finish("所有进程执行完成", { "平均等待时间": `${wait.toFixed(2)} ms`, "平均周转时间": `${turnaround.toFixed(2)} ms`, "完成时刻": `${time} ms` });
}
function deadlock(input: LabInputs) {
  const t = trace(); const allocated = sequence(input.allocations, "已分配", 100, 8); const maximum = sequence(input.maximums, "最大需求", 100, 8);
  if (allocated.length !== maximum.length || allocated.some((a, i) => a > maximum[i]!)) throw new Error("两组进程数量须相同，已分配不能超过最大需求");
  let work = Number(input.available); const done = new Set<number>(); const order: string[] = [];
  const table = () => ({ columns: ["进程", "已分配", "最大需求", "尚需", "检查结果"], rows: allocated.map((a, i) => [`P${i + 1}`, String(a), String(maximum[i]), String(maximum[i]! - a), done.has(i) ? "可完成" : "待检查"]) });
  t.add("开始安全性检查", `单类资源，初始 Work=${work}。尝试找到可依次完成的进程。`, ["cpu", "ram"], { "Work": work }, { table: table() });
  while (done.size < allocated.length) {
    const i = allocated.findIndex((a, k) => !done.has(k) && maximum[k]! - a <= work);
    if (i < 0) {
      t.add("未找到安全序列", "剩余进程的最大剩余需求均超过 Work。该状态不安全，但不能仅凭安全性检查断定已发生死锁。", ["ram"], { "Work": work }, { table: table() });
      return t.finish("当前状态不安全：无法找到完整安全序列", { "可完成进程": done.size, "剩余进程": allocated.length - done.size }, "blocked");
    }
    done.add(i); work += allocated[i]!; order.push(`P${i + 1}`);
    t.add(`${order.at(-1)} 可完成`, `尚需 ${maximum[i]! - allocated[i]!} 个资源可被满足，假定该进程运行结束后归还原已分配的 ${allocated[i]} 个，Work=${work}。`, ["cpu", "ram"], { "Work": work }, { table: table(), cells: allocated.map((_, k) => ({ label: `P${k + 1}`, value: done.has(k) ? "可完成" : "待检查", ...(k === i ? { state: "active" as const } : {}) })) });
  }
  return t.finish("找到完整安全序列", { "安全序列": order.join(" → "), "最终 Work": work });
}
function disk(input: LabInputs) {
  const t = trace(); const requests = sequence(input.requests, "磁道请求", 199, 32); let head = Number(input.head); let distance = 0;
  const pending = [...requests]; const route: { track: number; boundary: boolean }[] = [];
  if (input.policy === "FCFS") pending.forEach((track) => route.push({ track, boundary: false }));
  else if (input.policy === "SSTF") {
    let current = head;
    while (pending.length) { let best = 0; pending.forEach((n, i) => { if (Math.abs(n - current) < Math.abs(pending[best]! - current)) best = i; }); current = pending.splice(best, 1)[0]!; route.push({ track: current, boundary: false }); }
  } else {
    const low = pending.filter((n) => n < head).sort((a, b) => b - a);
    const high = pending.filter((n) => n >= head).sort((a, b) => a - b);
    const up = input.direction === "向高磁道";
    const first = up ? high : low; const second = up ? low : high; const end = up ? 199 : 0;
    first.forEach((track) => route.push({ track, boundary: false }));
    if (second.length && route.at(-1)?.track !== end) route.push({ track: end, boundary: true });
    second.forEach((track) => route.push({ track, boundary: false }));
  }
  t.add("磁头就位", `初始磁道 ${head}；范围 0–199，算法 ${input.policy}。处理完最后请求后停止移动。`, ["disk"], { "当前磁道": head, "磁头移动距离": "0 磁道" });
  for (const step of route) {
    const move = Math.abs(step.track - head); distance += move;
    t.add(step.boundary ? "到达盘边 · 反向扫描" : `服务磁道 ${step.track}`, `${head} → ${step.track}，移动 ${move} 个磁道。${step.boundary ? "SCAN 到达物理边界后改变方向。" : ""}`, ["disk"], { "当前磁道": step.track, "磁头移动距离": `${distance} 磁道` }, { cells: [{ label: "磁头", value: String(step.track), state: "active" }] }); head = step.track;
  }
  return t.finish("所有磁道请求处理完成", { "磁头移动距离": `${distance} 磁道`, "服务请求数": requests.length, "最终磁道": head });
}

export function runExperiment(lab: LabDefinition, inputs: LabInputs): LabRun {
  try {
    for (const f of lab.fields) {
      if (f.type === "number") integer(inputs[f.key], f.label, f.min, f.max);
      if (f.options && !f.options.includes(inputs[f.key] ?? "")) throw new Error(`请选择有效的${f.label}`);
      if ((inputs[f.key]?.length ?? 0) > 2000) throw new Error(`${f.label}内容过长`);
    }
    if ((inputs.links?.length ?? 0) > 1000) throw new Error("连接记录过长");
    if (lab.course === "computer-networks") return network(lab, inputs);
    const engines: Record<string, (input: LabInputs) => LabRun> = { "co-cache": cache, "co-instruction": instruction, "co-pipeline": pipeline, "co-io": io, "os-pages": pages, "os-scheduling": scheduling, "os-deadlock": deadlock, "os-disk": disk };
    const engine = engines[lab.id];
    if (!engine) throw new Error("该实验不存在");
    return engine(inputs);
  } catch (error) {
    return { status: "invalid", summary: error instanceof Error ? error.message : "请检查实验参数", events: [], metrics: [] };
  }
}

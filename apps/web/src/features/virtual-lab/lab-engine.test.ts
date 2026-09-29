import { describe, expect, it } from "vitest";
import { defaultsFor, findLab, LABS } from "./lab-catalog";
import { runExperiment } from "./lab-engine";
const run = (id: string, override: Record<string, string> = {}) => {
  const lab = findLab(id)!;
  return runExperiment(lab, { ...defaultsFor(lab), ...override });
};
const metric = (result: ReturnType<typeof run>, label: string) => result.metrics.find((m) => m.label === label)?.value;
describe("network configuration determines communication", () => {
  it("delivers request and reply through the configured two subnets", () => {
    const result = run("network-routing");
    expect(result.status).toBe("success");
    expect(result.events.some((event) => event.path?.includes("router"))).toBe(true);
    expect(result.events.at(-1)?.title).toContain("应答");
  });
  it.each([
    ["192.168.99.1", "不在"],
    ["192.168.10.99", "ARP"],
  ])("diagnoses gateway %s rather than showing a success animation", (srcGateway, cause) => {
    const result = run("network-routing", { srcGateway });
    expect(result.status).toBe("blocked");
    expect(result.summary).toContain(cause);
  });
  it("cannot return a reply with a bad destination gateway", () => {
    expect(run("network-routing", { dstGateway: "192.168.20.99" }).status).toBe("blocked");
  });
  it("detects disconnection and recovers when links are restored", () => {
    expect(run("network-routing", { links: "pc-a:eth0~sw-a:1" }).status).toBe("blocked");
    expect(run("network-routing").status).toBe("success");
  });
  it("rejects invalid IPv4, noncontiguous masks and multiply occupied ports", () => {
    expect(run("network-routing", { srcIp: "999.1.1.1" }).status).toBe("invalid");
    expect(run("network-routing", { srcMask: "255.0.255.0" }).status).toBe("invalid");
    expect(run("network-routing", { links: "pc-a:eth0~sw-a:1|pc-a:eth0~sw-b:1" }).status).toBe("invalid");
  });
  it("resolves a LAN destination without using the router", () => {
    const result = run("network-arp");
    expect(result.status).toBe("success");
    expect(result.events.every((e) => !e.path?.includes("router"))).toBe(true);
  });
  it("accounts for SYN and retransmission in TCP sequence numbers", () => {
    const result = run("network-tcp", { payload: "1700", mss: "800", loss: "2", clientSeq: "100" });
    expect(metric(result, "最终确认号")).toBe("1801");
    expect(metric(result, "重传段数")).toBe("1");
  });
  it("reports DNS NXDOMAIN and HTTP unavailability separately", () => {
    expect(run("network-dns", { domain: "missing.lab" }).summary).toContain("NXDOMAIN");
    expect(run("network-dns", { http: "关闭" }).status).toBe("blocked");
    expect(run("network-dns").status).toBe("success");
  });
});
describe("architecture experiments", () => {
  it("computes direct-mapped conflict misses from byte addresses", () => {
    const result = run("co-cache", { addresses: "0,0,16,0", lines: "4", ways: "1", block: "4" });
    expect(metric(result, "命中次数")).toBe("1");
    expect(metric(result, "未命中次数")).toBe("3");
    expect(metric(result, "平均访问时间")).toBe("38.50 ns");
  });
  it("two-way association preserves two conflicting blocks", () => {
    expect(metric(run("co-cache", { addresses: "0,16,0,16", ways: "2" }), "命中次数")).toBe("2");
  });
  it("replaces the victim in its physical way without moving another line", () => {
    const result = run("co-cache", { addresses: "0,8,16", ways: "2", policy: "FIFO" });
    expect(result.events.at(-1)?.cells?.slice(0, 2).map((cell) => cell.value)).toEqual(["块 4", "块 2"]);
  });
  it("computes a 16-bit wrapped arithmetic result", () => {
    expect(metric(run("co-instruction", { a: "65535", b: "2" }), "R3")).toBe("1");
    expect(metric(run("co-instruction", { a: "1", b: "2", operation: "SUB" }), "R3")).toBe("65535");
  });
  it("includes MEM and stalls a dependent pair only when forwarding is disabled", () => {
    const instructions = "R1,R2,R3\nR4,R1,R5";
    expect(metric(run("co-pipeline", { instructions, forwarding: "开启" }), "总周期")).toBe("6");
    const slow = run("co-pipeline", { instructions, forwarding: "关闭" });
    expect(metric(slow, "总周期")).toBe("8");
    expect(slow.events.some((e) => e.table?.rows.some((row) => row.includes("MEM")))).toBe(true);
  });
  it("uses input-derived CPU overhead for DMA and per-word interrupts", () => {
    expect(metric(run("co-io", { words: "8", setup: "4", service: "6", mode: "DMA" }), "CPU 占用周期")).toBe("10");
    expect(metric(run("co-io", { words: "8", service: "6", mode: "逐字中断" }), "CPU 占用周期")).toBe("56");
  });
});
describe("operating system algorithms", () => {
  it("reproduces textbook FIFO/LRU page fault counts", () => {
    expect(metric(run("os-pages", { policy: "FIFO" }), "缺页次数")).toBe("10");
    expect(metric(run("os-pages", { policy: "LRU" }), "缺页次数")).toBe("9");
  });
  it("handles one frame and repeated hits", () => {
    expect(metric(run("os-pages", { references: "1 1 2 2 1", frames: "1" }), "缺页次数")).toBe("3");
  });
  it("calculates round-robin waiting times with arrivals before requeue", () => {
    const result = run("os-scheduling");
    expect(metric(result, "平均等待时间")).toBe("3.33 ms");
    expect(metric(result, "平均周转时间")).toBe("6.33 ms");
  });
  it("accounts for CPU idle time rather than dispatching a future process", () => {
    const result = run("os-scheduling", { processes: "3,2\n10,1", policy: "FCFS" });
    expect(metric(result, "平均等待时间")).toBe("0.00 ms");
    expect(metric(result, "完成时刻")).toBe("11 ms");
  });
  it("finds a safety sequence and distinguishes unsafe from proven deadlock", () => {
    expect(run("os-deadlock").status).toBe("success");
    const unsafe = run("os-deadlock", { available: "0" });
    expect(unsafe.status).toBe("blocked");
    expect(unsafe.summary).toContain("不安全");
  });
  it("computes canonical disk seek distances", () => {
    expect(metric(run("os-disk", { policy: "FCFS" }), "磁头移动距离")).toBe("640 磁道");
    expect(metric(run("os-disk", { policy: "SSTF" }), "磁头移动距离")).toBe("236 磁道");
    expect(metric(run("os-disk", { policy: "SCAN", direction: "向高磁道" }), "磁头移动距离")).toBe("331 磁道");
  });
  it.each(["", "1,NaN,2", "-1,2", "0xFFFFF00000000"])("rejects invalid sequence %s", (references) => {
    expect(run("os-pages", { references }).status).toBe("invalid");
  });
});
describe("catalog execution contract", () => {
  it.each(LABS.map((lab) => [lab.id]))("%s produces independent replayable snapshots", (id) => {
    const first = run(id!);
    expect(first.status).toBe("success");
    expect(first.events.length).toBeGreaterThan(1);
    expect(first).toEqual(run(id!));
    const source = JSON.stringify(first.events[0]);
    first.events.at(-1)?.metrics.push({ label: "test", value: "1" });
    expect(JSON.stringify(first.events[0])).toBe(source);
  });
});

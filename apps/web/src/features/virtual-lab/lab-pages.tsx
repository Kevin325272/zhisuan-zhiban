import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowDownToLine, ArrowLeft, ArrowRight, Cable, Check, ChevronRight, CircleHelp, Cpu, FlaskConical, HardDrive, History, Layers3, Monitor, Network, Pause, Play, RotateCcw, Save, Settings2, SkipBack, SkipForward, Unplug, X } from "lucide-react";
import { useAuth } from "../auth/auth-context";
import { COURSES, defaultsFor, findLab, LABS, LOCAL_LINKS, PORTS, ROUTED_LINKS } from "./lab-catalog";
import { parseLinks, runExperiment } from "./lab-engine";
import { LabViewport } from "./lab-viewport";
import { readLabRecords, saveLabRecord, type LabRecord } from "./lab-records";
import type { CourseId, LabDefinition, LabField, LabInputs, LabRun } from "./types";
import "../../styles/virtual-lab.css";

const BASE = "/student/programming-experiments";
const NAMES: Record<string, string> = { "pc-a": "主机 A", "pc-b": "主机 B", "sw-a": "交换机 S1", "sw-b": "交换机 S2", router: "路由器 R1", cpu: "CPU", cache: "Cache", ram: "主存", disk: "磁盘", io: "I/O 控制器" };
const CourseIcon = ({ course, size = 21 }: { course: string; size?: number }) => course === "computer-networks" ? <Network size={size} /> : course === "computer-organization" ? <Cpu size={size} /> : <Layers3 size={size} />;
const portName = (port: string) => `${NAMES[port.split(":")[0]!] ?? port} · ${port.split(":")[1]?.toUpperCase()}`;

function useRecords() {
  const { account } = useAuth(); const owner = account?.user_id ?? null;
  const [records, setRecords] = useState<LabRecord[]>([]); const [error, setError] = useState("");
  useEffect(() => {
    try { setRecords(readLabRecords(owner)); setError(""); }
    catch { setRecords([]); setError("本机实验记录暂时无法读取。你仍可开始新的实验。"); }
  }, [owner]);
  return { owner, records, setRecords, error };
}

export function LabCatalogPage() {
  const [course, setCourse] = useState<CourseId>("computer-networks");
  const { records, error } = useRecords(); const current = COURSES.find((c) => c.id === course)!;
  return <div className="vl-catalog">
    <header className="vl-catalog-heading"><div><span className="vl-eyebrow"><FlaskConical size={16} />408 交互实验</span><h1>仿真实验中心</h1><p>动手改变条件，看见原理如何发生。</p></div><div className="vl-catalog-count"><b>{LABS.length}</b><span>个实验 · 3 门课程</span></div></header>
    <nav className="vl-course-tabs" aria-label="仿真课程">{COURSES.map((c) => <button type="button" key={c.id} aria-pressed={course === c.id} onClick={() => setCourse(c.id)}><CourseIcon course={c.id} /><span><b>{c.name}</b><small>{c.description}</small></span><span className="vl-tab-count">{LABS.filter((l) => l.course === c.id).length}</span></button>)}</nav>
    <section className="vl-catalog-course" aria-label={`${current.name}实验列表`}>
      <div className="vl-section-heading"><div><span>{current.short} / 实验目录</span><h2>{current.name}</h2></div><p>每个实验都可以修改参数、单步运行和回看过程。</p></div>
      <div className="vl-lab-grid">{LABS.filter((l) => l.course === course).map((lab, index) => <article className="vl-lab-card student-action-card" key={lab.id}>
        <div className="vl-card-top"><span className="vl-lab-number">{current.short} — {String(index + 1).padStart(2, "0")}</span><CourseIcon course={course} size={25} /></div>
        <h3>{lab.title}</h3><p>{lab.description}</p><div className="vl-concepts">{lab.concepts.map((c) => <span key={c}>{c}</span>)}</div>
        <div className="vl-card-footer"><span>{lab.duration}</span><Link className="student-card-target" to={`${BASE}/${lab.id}`}>进入实验<ArrowRight size={16} /></Link></div>
      </article>)}</div>
    </section>
    <section className="vl-recent" aria-label="本机实验记录"><div className="vl-section-heading"><h2><History size={18} />最近的实验</h2><span>保存在当前账号的本机浏览器中</span></div>
      {error && <p role="alert">{error}</p>}
      {records.length ? <ul>{records.slice(0, 6).map((record) => <li key={record.id}><div><b>{record.title}</b><span>{new Date(record.savedAt).toLocaleString("zh-CN")} · 第 {record.step + 1} 步</span></div><Link to={`${BASE}/${record.labId}?record=${encodeURIComponent(record.id)}`}>继续观察<ArrowRight size={15} /></Link></li>)}</ul> : <p className="vl-empty">完成一次操作后保存，就能从这里恢复参数与观察位置。</p>}
    </section>
  </div>;
}

function Field({ field, value, onChange }: { field: LabField; value: string; onChange: (value: string) => void }) {
  const id = `vl-field-${field.key}`;
  return <div className="vl-field"><label htmlFor={id}>{field.label}</label>{field.options ? <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>{field.options.map((option) => <option key={option}>{option}</option>)}</select> : field.type === "textarea" ? <textarea id={id} value={value} rows={3} onChange={(e) => onChange(e.target.value)} spellCheck={false} /> : <input id={id} value={value} type={field.type === "number" ? "number" : "text"} min={field.min} max={field.max} onChange={(e) => onChange(e.target.value)} spellCheck={false} />}{field.hint && <p>{field.hint}</p>}</div>;
}

export function LabDetailPage() {
  const { labId } = useParams<{ labId: string }>(); const lab = findLab(labId);
  if (!lab) return <section className="vl-not-found"><FlaskConical size={36} /><h1>未找到这个实验</h1><p>从实验目录中重新选择一个实验。</p><Link to={BASE}>返回实验目录<ArrowRight size={17} /></Link></section>;
  return <LabWorkspace key={lab.id} lab={lab} />;
}

export function LabWorkspace({ lab }: { lab: LabDefinition }) {
  const [inputs, setInputs] = useState<LabInputs>(() => defaultsFor(lab));
  const [result, setResult] = useState<LabRun | null>(null); const [index, setIndex] = useState(0); const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState(lab.course === "computer-networks" ? "pc-a" : lab.id === "os-disk" ? "disk" : lab.id === "os-pages" ? "ram" : "cpu");
  const [inspector, setInspector] = useState<"device" | "parameters" | "connections">(lab.course === "computer-networks" ? "device" : "parameters");
  const [exploded, setExploded] = useState(false); const [speed, setSpeed] = useState("1"); const [notice, setNotice] = useState(""); const [showTask, setShowTask] = useState(true);
  const [from, setFrom] = useState("pc-a:eth0"); const [to, setTo] = useState("sw-a:1");
  const { owner, records, setRecords, error: recordError } = useRecords(); const [search] = useSearchParams();
  const recordId = search.get("record");
  useEffect(() => {
    if (!recordId || !owner) return;
    try {
      const saved = readLabRecords(owner).find((r) => r.id === recordId && r.labId === lab.id);
      if (!saved) { setNotice("未找到这条本机记录，已打开新的实验。"); return; }
      setInputs(saved.inputs); setResult(runExperiment(lab, saved.inputs)); setIndex(saved.step); setPlaying(false); setNotice("已恢复保存的参数和观察位置");
    } catch { setNotice("无法恢复这条记录，请从实验目录重新进入。"); }
  }, [recordId, owner, lab]);
  useEffect(() => {
    if (!playing || !result || result.events.length === 0) return;
    if (index >= result.events.length - 1) { setPlaying(false); return; }
    const timer = window.setTimeout(() => setIndex((value) => Math.min(value + 1, result.events.length - 1)), 1600 / Number(speed));
    return () => window.clearTimeout(timer);
  }, [playing, index, result, speed]);
  const event = result?.events[index] ?? null;
  const finished = !!result?.events.length && index === result.events.length - 1;
  const network = lab.course === "computer-networks";
  const course = COURSES.find((c) => c.id === lab.course)!;
  const links = useMemo(() => { try { return parseLinks(inputs.links ?? ""); } catch { return []; } }, [inputs.links]);
  const sceneState = useMemo(() => ({ selected, links: inputs.links ?? "", event, playing, exploded }), [selected, inputs.links, event, playing, exploded]);
  function change(values: Partial<LabInputs>) {
    setInputs((previous) => ({ ...previous, ...values } as LabInputs)); setResult(null); setIndex(0); setPlaying(false); setNotice("");
  }
  function start(auto: boolean) {
    const next = runExperiment(lab, inputs); setResult(next); setIndex(0); setNotice(""); setPlaying(auto && next.events.length > 1);
  }
  function advance(delta: number) {
    setPlaying(false);
    if (!result) { start(false); return; }
    setIndex((previous) => Math.max(0, Math.min(result.events.length - 1, previous + delta)));
  }
  function reset() { setInputs(defaultsFor(lab)); setResult(null); setIndex(0); setPlaying(false); setNotice(""); }
  function save() {
    try { setRecords(saveLabRecord(owner, lab, inputs, index)); setNotice("已保存到本机实验记录"); }
    catch (e) { setNotice(e instanceof Error && e.message.startsWith("请") ? e.message : "保存失败：浏览器存储不可用或空间不足。当前实验仍保留在页面中。"); }
  }
  function selectDevice(id: string, port?: string) {
    setSelected(id);
    if (network) { setInspector(port ? "connections" : "device"); if (port) setFrom(port); }
  }
  function connect() {
    try {
      const proposed = [...links, [from, to]].map((pair) => pair.join("~")).join("|"); parseLinks(proposed); change({ links: proposed }); setNotice(`已连接 ${portName(from)} 与 ${portName(to)}`);
    } catch (e) { setNotice(e instanceof Error ? e.message : "连接失败"); }
  }
  const deviceFields = lab.fields.filter((f) => f.device === selected);
  const genericFields = lab.fields.filter((f) => !f.device);
  const activeMetrics = finished ? result!.metrics : event?.metrics ?? [];
  return <div className="vl-workspace">
    <header className="vl-workspace-heading"><div className="vl-breadcrumb"><Link to={BASE}><ArrowLeft size={16} />实验目录</Link><ChevronRight size={14} /><span>{course.name}</span></div><div className="vl-title-row"><h1>{lab.title}</h1><div><button type="button" onClick={() => setShowTask((v) => !v)} aria-expanded={showTask}><CircleHelp size={15} />实验任务</button><button type="button" onClick={save} disabled={!result || result.status === "invalid"}><Save size={15} />保存记录</button></div></div></header>
    <div className="vl-mobile-lab-switch"><label htmlFor="vl-choose-lab">切换实验</label><select id="vl-choose-lab" value={lab.id} onChange={(e) => { window.location.assign(`${BASE}/${e.target.value}`); }}>{LABS.map((l) => <option value={l.id} key={l.id}>{l.title}</option>)}</select></div>
    <div className="vl-studio">
      <aside className="vl-directory"><Link className="vl-directory-brand" to={BASE}><FlaskConical size={18} /><span>408 实验室</span></Link>{COURSES.map((c) => <div className="vl-directory-group" key={c.id}><h2><CourseIcon course={c.id} size={15} />{c.name}</h2><nav aria-label={`${c.name}实验`}>{LABS.filter((l) => l.course === c.id).map((l) => <Link key={l.id} to={`${BASE}/${l.id}`} aria-current={l.id === lab.id ? "page" : undefined}><span>{l.title}</span>{l.id === lab.id && <ChevronRight size={14} />}</Link>)}</nav></div>)}<div className="vl-directory-foot"><Layers3 size={15} /><span>选择实验，动手探索</span></div></aside>
      <div className="vl-main-scene">
        {showTask && <div className="vl-task"><div><span>本次任务</span><p>{lab.task}</p></div><button type="button" aria-label="收起实验任务" onClick={() => setShowTask(false)}><X size={16} /></button></div>}
        <LabViewport lab={lab} state={sceneState} onSelect={selectDevice} onExplode={() => setExploded((v) => !v)} />
        <div className="vl-playback"><div className="vl-play-buttons"><button type="button" onClick={() => advance(-1)} disabled={!result || index === 0} aria-label="上一步"><SkipBack size={17} /></button><button className="vl-play" type="button" onClick={() => playing ? setPlaying(false) : !result || finished || result.status === "invalid" ? start(true) : setPlaying(true)}>{playing ? <Pause size={17} /> : <Play size={17} />}{playing ? "暂停" : !result || finished || result.status === "invalid" ? "运行实验" : "继续播放"}</button><button type="button" onClick={() => advance(1)} disabled={finished} aria-label="下一步"><SkipForward size={17} /></button></div><div className="vl-scrub"><label htmlFor="vl-playhead">{result?.events.length ? `${index + 1} / ${result.events.length}` : "尚未运行"}</label><input id="vl-playhead" aria-label="回放位置" type="range" min={0} max={Math.max(1, (result?.events.length ?? 1) - 1)} value={index} disabled={!result?.events.length} onChange={(e) => { setPlaying(false); setIndex(Number(e.target.value)); }} /></div><select aria-label="播放速度" value={speed} onChange={(e) => setSpeed(e.target.value)}><option value="0.5">0.5×</option><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select><button type="button" aria-label="重置实验" title="重置实验" onClick={reset}><RotateCcw size={16} /></button></div>
      </div>
      <aside className="vl-inspector" aria-label="实验配置与观测">
        <div className="vl-inspector-title"><Settings2 size={17} /><h2>配置与观测</h2></div>
        {network && <div className="vl-inspector-tabs" role="tablist" aria-label="配置面板">{([["device", "设备"], ["connections", "接线"], ["parameters", "实验"]] as const).map(([value, label]) => <button key={value} id={`vl-tab-${value}`} aria-controls="vl-inspector-panel" type="button" role="tab" aria-selected={inspector === value} onClick={() => setInspector(value)}>{label}</button>)}</div>}
        <div className="vl-inspector-body" id="vl-inspector-panel" role={network ? "tabpanel" : undefined} aria-labelledby={network ? `vl-tab-${inspector}` : undefined}>
          {network && inspector === "device" && <><div className="vl-selected-device"><Monitor size={24} /><div><span>当前设备</span><h3>{NAMES[selected]}</h3></div></div><select aria-label="选择配置设备" value={selected} onChange={(e) => setSelected(e.target.value)}>{["pc-a", "sw-a", "router", "sw-b", "pc-b"].map((id) => <option value={id} key={id}>{NAMES[id]}</option>)}</select>{deviceFields.map((f) => <Field key={f.key} field={f} value={inputs[f.key] ?? ""} onChange={(value) => change({ [f.key]: value })} />)}{!deviceFields.length && <p className="vl-panel-help">交换机学习源 MAC 地址，通过端口转发以太网帧。点击机身上的端口或进入接线面板更改连接。</p>}<button type="button" className="vl-panel-action" onClick={() => setInspector("connections")}><Cable size={15} />查看设备接线<ArrowRight size={14} /></button></>}
          {network && inspector === "connections" && <><h3>连接实验设备</h3><p className="vl-panel-help">点击模型网口选择起点，再选择另一台设备的空闲端口。</p><div className="vl-field"><label htmlFor="vl-port-from">起点端口</label><select id="vl-port-from" value={from} onChange={(e) => setFrom(e.target.value)}>{PORTS.map((p) => <option key={p} value={p}>{portName(p)}</option>)}</select></div><div className="vl-field"><label htmlFor="vl-port-to">终点端口</label><select id="vl-port-to" value={to} onChange={(e) => setTo(e.target.value)}>{PORTS.map((p) => <option key={p} value={p}>{portName(p)}</option>)}</select></div><button className="vl-primary" type="button" onClick={connect}><Cable size={16} />连接端口</button><div className="vl-wire-heading"><h4>已连接 · {links.length}</h4><button type="button" onClick={() => change({ links: lab.id === "network-arp" ? LOCAL_LINKS : ROUTED_LINKS })}>恢复接线</button></div><ul className="vl-wire-list">{links.map(([a, b], k) => <li key={`${a}~${b}`}><div><span>{portName(a)}</span><span>↳ {portName(b)}</span></div><button type="button" aria-label={`断开 ${portName(a)} 与 ${portName(b)}`} onClick={() => change({ links: links.filter((_, i) => i !== k).map((pair) => pair.join("~")).join("|") })}><Unplug size={15} /></button></li>)}</ul>{!links.length && <p className="vl-panel-help">当前没有网线，请连接设备。</p>}</>}
          {(!network || inspector === "parameters") && <><h3>实验参数</h3>{genericFields.length ? genericFields.map((f) => <Field key={f.key} field={f} value={inputs[f.key] ?? ""} onChange={(value) => change({ [f.key]: value })} />) : <p className="vl-panel-help">在“设备”中配置 IP 和网关，在“接线”中改变物理连接。运行后按事件逐步检查转发过程。</p>}{network && lab.id !== "network-arp" && <div className="vl-scenarios"><h4>故障练习</h4><button type="button" onClick={() => { change({ srcGateway: "192.168.10.99" }); setSelected("pc-a"); setInspector("device"); }}>设置错误网关<ArrowRight size={14} /></button><button type="button" onClick={() => change({ links: links.slice(1).map((pair) => pair.join("~")).join("|") })}>断开主机侧连接<Unplug size={14} /></button></div>}</>}
          {recordError && <p className="vl-panel-help">{recordError}</p>}
          <div className="vl-panel-footer"><ArrowDownToLine size={14} /><span>修改参数后，从头重新运行</span></div>
        </div>
      </aside>
      <section className="vl-observation" aria-label="实验过程与结果">
        {result?.status === "invalid" ? <div className="vl-input-error" role="alert"><h2>检查实验参数</h2><p>{result.summary}</p></div> : <>
          <div className="vl-observation-heading"><span className={`vl-run-status ${finished ? result?.status === "blocked" ? "is-blocked" : "is-complete" : ""}`}>{finished ? result?.status === "blocked" ? "需要排查" : "本次完成" : playing ? "正在运行" : result ? "已暂停" : "准备就绪"}</span><h2>{event?.title ?? "从一次操作开始"}</h2><span>{event ? `事件 ${index + 1}` : course.short}</span></div>
          <p className="vl-event-detail">{event?.detail ?? (network ? "选择设备检查地址，或进入接线面板连接网口。准备好后运行实验，观察报文的实际路径。" : "调整右侧参数并运行实验，观察部件变化和每一步的计算依据。")}</p>
          {activeMetrics.length > 0 && <dl className="vl-metrics">{activeMetrics.map((m) => <div key={m.label}><dt>{m.label}</dt><dd>{m.value}</dd></div>)}</dl>}
          {event?.cells && <div className="vl-state-cells" aria-label="当前资源状态">{event.cells.map((cell, i) => <div key={`${cell.label}-${i}`} data-state={cell.state}><span>{cell.label}</span><b>{cell.value}</b></div>)}</div>}
          {event?.table && <div className="vl-table-scroll"><table><thead><tr>{event.table.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead><tbody>{event.table.rows.map((row, i) => <tr key={i}>{row.map((v, k) => <td key={k}>{v}</td>)}</tr>)}</tbody></table></div>}
          {!!result?.events.length && <details className="vl-trace"><summary><History size={15} />完整事件轨迹 <span>{result.events.length} 步</span></summary><ol>{result.events.map((entry, k) => <li key={k} data-current={k === index}><button type="button" onClick={() => { setIndex(k); setPlaying(false); }}><span>{String(k + 1).padStart(2, "0")}</span><div><b>{entry.title}</b><p>{entry.detail}</p></div>{k === index && <Check size={15} />}</button></li>)}</ol></details>}
        </>}
      </section>
    </div>
    {notice && <div className="vl-notice" role="status">{notice}<button type="button" aria-label="关闭提示" onClick={() => setNotice("")}><X size={15} /></button></div>}
    <footer className="vl-workspace-footer"><span><HardDrive size={14} />本机记录 {records.filter((r) => r.labId === lab.id).length} 条</span><span>{lab.concepts.join(" · ")}</span></footer>
  </div>;
}

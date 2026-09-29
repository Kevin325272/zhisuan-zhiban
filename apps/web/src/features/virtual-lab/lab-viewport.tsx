import { useEffect, useRef, useState } from "react";
import { Layers3, Minus, Plus, RotateCcw } from "lucide-react";
import type { SceneApi, SceneState } from "./three-scene";
import type { LabDefinition } from "./types";

export function LabViewport({ lab, state, onSelect, onExplode }: { lab: LabDefinition; state: SceneState; onSelect: (id: string, port?: string) => void; onExplode: () => void }) {
  const host = useRef<HTMLDivElement>(null); const labels = useRef<HTMLDivElement>(null); const api = useRef<SceneApi | null>(null);
  const selection = useRef(onSelect); selection.current = onSelect;
  const current = useRef(state); current.current = state;
  const [renderState, setRenderState] = useState("loading");
  useEffect(() => {
    let cancelled = false; setRenderState("loading");
    void import("./three-scene").then(({ createLabScene }) => {
      if (cancelled || !host.current || !labels.current) return;
      try {
        api.current = createLabScene(host.current, labels.current, lab.course, lab.id, (id, port) => selection.current(id, port));
        api.current.update(current.current); setRenderState("ready");
      } catch { host.current.replaceChildren(); setRenderState("unavailable"); }
    }).catch(() => { if (!cancelled) setRenderState("unavailable"); });
    return () => { cancelled = true; api.current?.dispose(); api.current = null; };
  }, [lab.course, lab.id]);
  useEffect(() => { api.current?.update(state); }, [state]);
  return <div className="vl-viewport" data-renderer={renderState}>
    <div aria-hidden="true" className="vl-scene-caption"><span>三维实验台</span><b>{lab.course === "computer-networks" ? "网络设备与物理连接" : lab.course === "computer-organization" ? "计算机内部 · 部件观察" : "资源与状态 · 过程观察"}</b></div>
    <div className="vl-canvas-host" ref={host} />
    <div className="vl-device-labels" ref={labels} />
    {renderState !== "ready" && <div className="vl-render-message" role="status">{renderState === "loading" ? "正在准备三维实验台…" : "当前浏览器未能显示三维场景。请使用支持 WebGL 2 的浏览器；下方实验计算仍可操作。"}</div>}
    <div className="vl-view-controls" aria-label="视角控制">
      {lab.course !== "computer-networks" && <button type="button" onClick={onExplode} aria-pressed={state.exploded}><Layers3 size={15} />分层观察</button>}
      <button type="button" aria-label="放大视图" onClick={() => api.current?.zoom(0.86)}><Plus size={17} /></button>
      <button type="button" aria-label="缩小视图" onClick={() => api.current?.zoom(1.16)}><Minus size={17} /></button>
      <button type="button" aria-label="重置视角" onClick={() => api.current?.reset()}><RotateCcw size={16} /></button>
    </div>
    <div className="vl-gesture">拖动旋转 · 滚轮缩放 · 点击设备选择</div>
  </div>;
}

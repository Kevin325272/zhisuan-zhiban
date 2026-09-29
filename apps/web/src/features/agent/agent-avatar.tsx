import { Bot } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function AgentAvatar({ compact = false }: { compact?: boolean }) {
  const container = useRef<HTMLSpanElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!container.current || !window.WebGLRenderingContext) return;
    let active = true;
    let dispose: (() => void) | undefined;
    void import("./agent-avatar-scene").then(({ mountAgentAvatar }) => {
      if (!active || !container.current) return;
      try {
        dispose = mountAgentAvatar(container.current);
        setReady(true);
      } catch {
        // Keep the icon usable when the device cannot initialize WebGL.
      }
    }).catch(() => undefined);
    return () => { active = false; dispose?.(); };
  }, []);

  return (
    <span aria-hidden="true" className={`agent-avatar${compact ? " is-compact" : ""}`}>
      <span className="agent-avatar-canvas" ref={container} />
      {!ready ? <Bot className="agent-avatar-fallback" size={compact ? 22 : 32} /> : null}
    </span>
  );
}

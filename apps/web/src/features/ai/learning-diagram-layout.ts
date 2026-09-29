import type { LearningDiagram } from "@xuetu/contracts";

export function layoutLearningDiagram(diagram: LearningDiagram) {
  if (diagram.kind === "flow") {
    const twoRows = diagram.nodes.length > 3;
    return {
      height: twoRows ? 280 : 146,
      nodeWidth: 184,
      positions: diagram.nodes.map((node, index) => ({
        id: node.id,
        x: !twoRows ? 110 + index * 500 / (diagram.nodes.length - 1) : index < 3 ? 110 + index * 250 : 610 - (index - 3) * 250,
        y: !twoRows ? 73 : index < 3 ? 54 : 218,
      })),
    };
  }

  // Lay out the actual relationships, including nested groups and cross-links.
  // First-visit depths keep cycles finite; disconnected nodes remain visible.
  const depths = new Map<string, number>([[diagram.nodes[0]!.id, 0]]);
  const queue = [diagram.nodes[0]!.id];
  for (let index = 0; index < queue.length; index += 1) {
    const from = queue[index]!;
    for (const edge of diagram.edges.filter((item) => item.from === from)) {
      if (depths.has(edge.to)) continue;
      depths.set(edge.to, depths.get(from)! + 1);
      queue.push(edge.to);
    }
  }
  const detachedDepth = Math.max(...depths.values()) + 1;
  for (const node of diagram.nodes) if (!depths.has(node.id)) depths.set(node.id, detachedDepth);
  const layerCount = Math.max(...depths.values()) + 1;
  const layers = Array.from({ length: layerCount }, (_, depth) => diagram.nodes.filter((node) => depths.get(node.id) === depth));
  const widestLayer = Math.max(...layers.map((layer) => layer.length));
  const nodeWidth = Math.min(160, 600 / widestLayer - 16);
  return {
    height: 120 + (layerCount - 1) * 150,
    nodeWidth,
    positions: diagram.nodes.map((node) => {
      const depth = depths.get(node.id)!;
      const layer = layers[depth]!;
      const index = layer.findIndex((item) => item.id === node.id);
      const spacing = Math.min(280, 580 / Math.max(1, layer.length - 1));
      return { id: node.id, x: 360 + (index - (layer.length - 1) / 2) * spacing, y: 60 + depth * 150 };
    }),
  };
}

export function compactStartingRationale(value: string) {
  const separatorIndex = value.search(/[；;]/u);
  if (separatorIndex < 0) return value.trim();

  const boundary = value.slice(separatorIndex + 1).trim();
  if (!boundary.startsWith("这不是")) return value.trim();

  const rationale = value.slice(0, separatorIndex).trim().replace(/[。.!！?？]+$/u, "");
  return rationale ? `${rationale}。` : "";
}

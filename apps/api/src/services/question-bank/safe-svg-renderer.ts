import { createHash } from "node:crypto";

import { parseFragment, type DefaultTreeAdapterTypes } from "parse5";
import sharp from "sharp";

const maximumHtmlBytes = 16 * 1024 * 1024;
const maximumSvgBytes = 8 * 1024 * 1024;
const maximumEmbeddedImageBytes = 5 * 1024 * 1024;
const maximumRenderedPixels = 20_000_000;
const maximumSvgElements = 128;

const allowedTags = new Set([
  "defs",
  "ellipse",
  "g",
  "image",
  "path",
  "pattern",
  "rect",
  "svg",
  "switch",
  "text",
  "tspan",
]);

const allowedAttributes = new Set([
  "cx",
  "cy",
  "d",
  "dominant-baseline",
  "dx",
  "dy",
  "fill",
  "fill-opacity",
  "font-family",
  "font-size",
  "font-weight",
  "height",
  "id",
  "opacity",
  "patterntransform",
  "patternunits",
  "points",
  "pointer-events",
  "preserveaspectratio",
  "rx",
  "ry",
  "shape-rendering",
  "stroke",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-width",
  "text-anchor",
  "transform",
  "viewbox",
  "width",
  "x",
  "x1",
  "x2",
  "y",
  "y1",
  "y2",
]);

const canonicalAttributeNames: Record<string, string> = {
  patterntransform: "patternTransform",
  patternunits: "patternUnits",
  preserveaspectratio: "preserveAspectRatio",
  viewbox: "viewBox",
};

type SvgElement = DefaultTreeAdapterTypes.Element;
type SvgNode = DefaultTreeAdapterTypes.ChildNode;

export interface RenderedSafeSvg {
  content: Buffer;
  sourceSha256: string;
}

export class SafeSvgRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SafeSvgRenderError";
  }
}

function escapeXmlText(value: string) {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;");
}

function escapeXmlAttribute(value: string) {
  return escapeXmlText(value).replace(/"/gu, "&quot;");
}

function hasImageSignature(content: Buffer, mimeType: string) {
  if (mimeType === "image/png") {
    return content.length >= 8
      && content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  if (mimeType === "image/jpeg") {
    return content.length >= 3
      && content[0] === 0xff
      && content[1] === 0xd8
      && content[2] === 0xff;
  }
  if (mimeType === "image/gif") {
    const signature = content.subarray(0, 6).toString("ascii");
    return signature === "GIF87a" || signature === "GIF89a";
  }
  return mimeType === "image/webp"
    && content.length >= 12
    && content.subarray(0, 4).toString("ascii") === "RIFF"
    && content.subarray(8, 12).toString("ascii") === "WEBP";
}

function canonicalEmbeddedImage(value: string) {
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([a-z0-9+/=\s]+)$/iu.exec(value);
  if (!match?.[1] || match[2] === undefined) {
    throw new SafeSvgRenderError("Unsafe SVG image reference.");
  }
  const mimeType = match[1].toLowerCase();
  const compact = match[2].replace(/\s/gu, "");
  if (!compact || compact.length % 4 === 1) {
    throw new SafeSvgRenderError("Unsafe SVG image payload.");
  }
  const content = Buffer.from(compact, "base64");
  if (
    content.length === 0
    || content.length > maximumEmbeddedImageBytes
    || content.toString("base64").replace(/=+$/u, "") !== compact.replace(/=+$/u, "")
    || !hasImageSignature(content, mimeType)
  ) {
    throw new SafeSvgRenderError("Unsafe SVG image payload.");
  }
  return `data:${mimeType};base64,${content.toString("base64")}`;
}

function safeFontSize(value: string) {
  const normalized = value.trim();
  if (normalized === "smaller" || normalized === "larger") return normalized;
  const numeric = /^(\d+(?:\.\d+)?|\.\d+)(?:em|px|%)?$/u.exec(normalized);
  if (numeric?.[1]) {
    const amount = Number(numeric[1]);
    if (Number.isFinite(amount) && amount > 0 && amount <= 512) return normalized;
  }
  throw new SafeSvgRenderError("Unsafe SVG font size.");
}

function fontSizeFromStyle(value: string) {
  if (/url\s*\(|@import|expression\s*\(|javascript:/iu.test(value)) {
    throw new SafeSvgRenderError("Unsafe SVG style reference.");
  }
  for (const declaration of value.split(";")) {
    const separator = declaration.indexOf(":");
    if (separator < 0) continue;
    if (declaration.slice(0, separator).trim().toLowerCase() !== "font-size") continue;
    return safeFontSize(declaration.slice(separator + 1));
  }
  return null;
}

function safeDimension(value: string, name: "height" | "width") {
  const normalized = value.trim();
  const numeric = /^(\d+(?:\.\d+)?|\.\d+)(em|px|%)?$/u.exec(normalized);
  if (numeric?.[1]) {
    const amount = Number(numeric[1]);
    const maximum = numeric[2] === "em" ? 512 : 100_000;
    if (Number.isFinite(amount) && amount >= 0 && amount <= maximum) return normalized;
  }
  throw new SafeSvgRenderError(`Unsafe SVG ${name} value.`);
}

function safeAttributeValue(name: string, value: string) {
  if (value.length > 1_000_000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) {
    throw new SafeSvgRenderError(`Unsafe SVG ${name} attribute.`);
  }
  if (name === "id") {
    if (!/^[a-z_][a-z0-9_.:-]{0,127}$/iu.test(value)) {
      throw new SafeSvgRenderError("Unsafe SVG id attribute.");
    }
    return value;
  }
  if (name === "d") {
    if (!/^[a-z0-9e+.,\s-]+$/iu.test(value)) {
      throw new SafeSvgRenderError("Unsafe SVG path data.");
    }
    return value;
  }
  if (name === "transform" || name === "patterntransform") {
    if (!/^[a-z0-9eE+.,()\s-]+$/iu.test(value)) {
      throw new SafeSvgRenderError("Unsafe SVG transform.");
    }
    return value;
  }
  if (name === "fill" || name === "stroke") {
    if (/url\s*\(/iu.test(value) && !/^url\(#[a-z_][a-z0-9_.:-]{0,127}\)$/iu.test(value)) {
      throw new SafeSvgRenderError("Unsafe SVG paint reference.");
    }
    if (!/^[a-z0-9#(),.%\s_:-]+$/iu.test(value)) {
      throw new SafeSvgRenderError("Unsafe SVG paint value.");
    }
    return value;
  }
  if (name === "font-family") {
    if (!/^[a-z0-9 ,.'"_-]{1,128}$/iu.test(value)) {
      throw new SafeSvgRenderError("Unsafe SVG font family.");
    }
    return value;
  }
  if (name === "font-size") return safeFontSize(value);
  if (name === "height" || name === "width") return safeDimension(value, name);
  if (
    name === "points"
    || name === "stroke-dasharray"
    || name === "viewbox"
    || [
      "cx", "cy", "dx", "dy", "fill-opacity", "opacity", "rx", "ry",
      "stroke-miterlimit", "stroke-width", "x", "x1", "x2", "y", "y1", "y2",
    ].includes(name)
  ) {
    if (!/^[0-9eE+.,%\s-]+$/u.test(value)) {
      throw new SafeSvgRenderError(`Unsafe SVG ${name} value.`);
    }
    return value;
  }
  if (!/^[a-z0-9_.\s-]+$/iu.test(value)) {
    throw new SafeSvgRenderError(`Unsafe SVG ${name} value.`);
  }
  return value;
}

function serializeSvgElement(element: SvgElement, root = false): string {
  const lowerTagName = element.tagName.toLowerCase();
  if (lowerTagName === "foreignobject" || lowerTagName === "style") return "";
  if (!allowedTags.has(lowerTagName)) {
    throw new SafeSvgRenderError(`Unsafe SVG element: <${element.tagName}>.`);
  }

  const attributes = new Map<string, string>();
  for (const attribute of element.attrs) {
    const lowerName = attribute.name.toLowerCase();
    if (lowerName.startsWith("on")) {
      throw new SafeSvgRenderError(`Unsafe SVG event attribute: ${attribute.name}.`);
    }
    if (lowerName === "style") {
      const fontSize = fontSizeFromStyle(attribute.value);
      if (fontSize && !attributes.has("font-size")) attributes.set("font-size", fontSize);
      continue;
    }
    if (lowerName === "href" || lowerName === "src") {
      if (lowerTagName !== "image" || lowerName !== "href") {
        throw new SafeSvgRenderError("Unsafe SVG resource reference.");
      }
      attributes.set("href", canonicalEmbeddedImage(attribute.value));
      continue;
    }
    if (!allowedAttributes.has(lowerName)) continue;
    const canonicalName = canonicalAttributeNames[lowerName] ?? lowerName;
    attributes.set(canonicalName, safeAttributeValue(lowerName, attribute.value));
  }
  if (lowerTagName === "image" && !attributes.has("href")) {
    throw new SafeSvgRenderError("Unsafe SVG image without an embedded payload.");
  }
  if (root) attributes.set("xmlns", "http://www.w3.org/2000/svg");

  const serializedAttributes = [...attributes.entries()]
    .map(([name, value]) => ` ${name}="${escapeXmlAttribute(value)}"`)
    .join("");
  const children = element.childNodes.map((child) => serializeSvgNode(child)).join("");
  return `<${lowerTagName}${serializedAttributes}>${children}</${lowerTagName}>`;
}

function serializeSvgNode(node: SvgNode): string {
  if ("value" in node) return escapeXmlText(node.value);
  if (!("tagName" in node)) return "";
  return serializeSvgElement(node);
}

function collectTopLevelSvgElements(
  node: DefaultTreeAdapterTypes.ParentNode,
  results: SvgElement[] = [],
) {
  for (const child of node.childNodes) {
    if (!("tagName" in child)) continue;
    if (child.tagName.toLowerCase() === "svg") {
      results.push(child);
      continue;
    }
    collectTopLevelSvgElements(child, results);
  }
  return results;
}

export class SafeSvgRenderer {
  readonly #cache = new Map<string, Promise<RenderedSafeSvg>>();

  async renderHtml(html: string): Promise<RenderedSafeSvg[]> {
    if (!html || !/<svg\b/iu.test(html)) return [];
    if (Buffer.byteLength(html, "utf8") > maximumHtmlBytes) {
      throw new SafeSvgRenderError("Unsafe SVG source exceeds the HTML size limit.");
    }
    const fragment = parseFragment(html);
    const elements = collectTopLevelSvgElements(fragment);
    if (elements.length > maximumSvgElements) {
      throw new SafeSvgRenderError(
        `SVG diagram count exceeds the ${maximumSvgElements}-diagram source limit.`,
      );
    }
    return Promise.all(elements.map((element) => this.#renderElement(element)));
  }

  async #renderElement(element: SvgElement): Promise<RenderedSafeSvg> {
    const sanitized = serializeSvgElement(element, true);
    if (Buffer.byteLength(sanitized, "utf8") > maximumSvgBytes) {
      throw new SafeSvgRenderError("Unsafe SVG source exceeds the render size limit.");
    }
    const sourceSha256 = createHash("sha256").update(sanitized).digest("hex");
    const cached = this.#cache.get(sourceSha256);
    if (cached) return cached;

    const rendered = sharp(Buffer.from(sanitized, "utf8"), {
      density: 72,
      failOn: "warning",
      limitInputPixels: maximumRenderedPixels,
    })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer({ resolveWithObject: true })
      .then(({ data, info }) => {
        if (
          info.format !== "png"
          || info.width <= 0
          || info.height <= 0
          || info.width * info.height > maximumRenderedPixels
        ) {
          throw new SafeSvgRenderError("Unsafe SVG rendered outside the image limits.");
        }
        return { content: data, sourceSha256 };
      })
      .catch((error: unknown) => {
        if (error instanceof SafeSvgRenderError) throw error;
        throw new SafeSvgRenderError(
          `Unable to render sanitized SVG: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    this.#cache.set(sourceSha256, rendered);
    return rendered;
  }
}

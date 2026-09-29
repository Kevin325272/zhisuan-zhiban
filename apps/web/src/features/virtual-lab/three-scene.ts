import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { CourseId, LabEvent } from "./types";
import { parseLinks } from "./lab-engine";

export interface SceneState { selected: string; links: string; event: LabEvent | null; playing: boolean; exploded: boolean }
export interface SceneApi { update(state: SceneState): void; reset(): void; zoom(factor: number): void; dispose(): void }
type Device = { root: THREE.Group; label: string; anchor: THREE.Vector3; badge: HTMLButtonElement; ring: THREE.Mesh; ports: Record<string, THREE.Vector3> };
const colors = { ink: 0x0c1d30, board: 0x123e42, silver: 0xa7b8c2, trim: 0x4b6474, green: 0x73e6bf, gold: 0xc4a76d };

// Models are authored here from mesh geometry: housings, ports, screws, fins,
// PCB traces and disk mechanics. No third-party device assets are embedded.
export function createLabScene(host: HTMLElement, labels: HTMLElement, course: CourseId, labId: string, onSelect: (id: string, port?: string) => void): SceneApi {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.setClearColor(0x0b1b2b);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.98;
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute("aria-label", "三维设备视图，可拖动旋转、滚轮缩放，点击设备或网口选择");
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0b1b2b, 24, 55);
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  const network = course === "computer-networks";
  camera.position.set(network ? 7.6 : 9, network ? 8.8 : 11, network ? 13.6 : 12.5);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.55, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.minDistance = 7;
  controls.maxDistance = 30;
  controls.minPolarAngle = 0.18;
  controls.maxPolarAngle = Math.PI / 2.12;
  controls.update(); controls.saveState();
  const environment = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(environment, 0.06);
  scene.environment = env.texture;
  scene.environmentIntensity = 0.65;
  environment.dispose(); pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xcee8fa, 0x10272e, 1.0));
  const key = new THREE.DirectionalLight(0xe6f4ff, 3.0);
  key.position.set(-5, 12, 7); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -10; key.shadow.camera.right = 10; key.shadow.camera.top = 10; key.shadow.camera.bottom = -10;
  key.shadow.normalBias = 0.025; scene.add(key);
  const rim = new THREE.DirectionalLight(0x66ddc3, 1.7); rim.position.set(3, 5, -8); scene.add(rim);
  const devices = new Map<string, Device>();
  const textures = new Set<THREE.Texture>();
  const materials: THREE.Material[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  function mat(color: number, metalness = 0.2, roughness = 0.5, emissive = false) {
    const material = new THREE.MeshStandardMaterial({ color, metalness, roughness, ...(emissive ? { emissive: color, emissiveIntensity: 0.6 } : {}) });
    materials.push(material); return material;
  }
  const silver = mat(colors.silver, 0.85, 0.28); const dark = mat(colors.ink, 0.5, 0.4);
  const boardMat = mat(colors.board, 0.35, 0.45); const gold = mat(colors.gold, 0.8, 0.3);
  const green = mat(colors.green, 0.4, 0.3, true); const black = mat(0x050e17, 0.1, 0.5);
  const pale = mat(0xd0dce1, 0.7, 0.32); const trim = mat(colors.trim, 0.7, 0.4);
  function mesh(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, pos: [number, number, number]) {
    geometries.push(geometry);
    const object = new THREE.Mesh(geometry, material); object.position.set(...pos); object.castShadow = true; object.receiveShadow = true; parent.add(object); return object;
  }
  function box(parent: THREE.Object3D, size: [number, number, number], pos: [number, number, number], material = dark, radius = 0) {
    return mesh(parent, radius ? new RoundedBoxGeometry(...size, 2, radius) : new THREE.BoxGeometry(...size), material, pos);
  }
  function cylinder(parent: THREE.Object3D, radius: number, height: number, pos: [number, number, number], material = silver) {
    return mesh(parent, new THREE.CylinderGeometry(radius, radius, height, 32), material, pos);
  }
  function texture(text: string, subtitle = "", screen = false) {
    const canvas = document.createElement("canvas"); canvas.width = 768; canvas.height = screen ? 460 : 180;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = screen ? "#0d273b" : "#142a3a"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#376073"; ctx.lineWidth = 2;
    if (screen) {
      for (let x = 40; x < 768; x += 44) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 460); ctx.stroke(); }
      for (let y = 30; y < 460; y += 44) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(768, y); ctx.stroke(); }
      ctx.fillStyle = "#113043"; ctx.fillRect(40, 40, 688, 365);
      ctx.fillStyle = "#72dfbc"; ctx.fillRect(64, 75, 12, 12);
      ctx.font = "24px sans-serif"; ctx.fillText("XUETU / NETWORK LAB", 92, 94);
      ctx.fillStyle = "#a6bfd0"; ctx.font = "22px monospace";
      ctx.fillText("ETHERNET  ·  IPv4", 64, 314); ctx.fillText("READY TO CONNECT", 64, 355);
    }
    ctx.fillStyle = "#e4f2f4"; ctx.font = `600 ${screen ? 66 : 44}px sans-serif`; ctx.fillText(text, screen ? 64 : 26, screen ? 200 : 70);
    ctx.fillStyle = "#80b6bb"; ctx.font = `${screen ? 32 : 27}px monospace`; ctx.fillText(subtitle, screen ? 64 : 26, screen ? 252 : 121);
    const result = new THREE.CanvasTexture(canvas); result.colorSpace = THREE.SRGBColorSpace; textures.add(result); return result;
  }
  function panel(parent: THREE.Object3D, text: string, subtitle: string, width: number, height: number, pos: [number, number, number], screen = false) {
    const material = new THREE.MeshBasicMaterial({ map: texture(text, subtitle, screen), toneMapped: false }); materials.push(material);
    return mesh(parent, new THREE.PlaneGeometry(width, height), material, pos);
  }
  function screws(parent: THREE.Object3D, w: number, d: number, y: number) {
    for (const x of [-w / 2, w / 2]) for (const z of [-d / 2, d / 2]) {
      cylinder(parent, 0.035, 0.015, [x, y, z], silver); box(parent, [0.04, 0.016, 0.008], [x, y + 0.01, z], black);
    }
  }
  function device(id: string, label: string, x: number, z: number, width: number, anchorY = 2.5) {
    const root = new THREE.Group(); root.position.set(x, 0, z); root.userData.device = id; scene.add(root);
    const ringMaterial = new THREE.MeshBasicMaterial({ color: colors.green, transparent: true, opacity: 0.85, side: THREE.DoubleSide }); materials.push(ringMaterial);
    const ring = mesh(root, new THREE.RingGeometry(width * 0.55, width * 0.55 + 0.025, 64), ringMaterial, [0, 0.03, 0]); ring.rotation.x = -Math.PI / 2; ring.visible = false;
    const badge = document.createElement("button"); badge.type = "button"; badge.className = "vl-device-label"; badge.textContent = label; badge.setAttribute("aria-label", `选择${label}`); badge.dataset.device = id;
    badge.addEventListener("click", () => onSelect(id)); labels.appendChild(badge);
    const result: Device = { root, label, anchor: new THREE.Vector3(x, anchorY, z), badge, ring, ports: {} }; devices.set(id, result); return result;
  }
  function port(d: Device, name: string, pos: [number, number, number]) {
    const housing = box(d.root, [0.23, 0.20, 0.095], pos, silver, 0.012); housing.userData.port = name;
    const hole = box(d.root, [0.17, 0.13, 0.025], [pos[0], pos[1], pos[2] + 0.052], black); hole.userData.port = name;
    for (let pin = 0; pin < 5; pin++) box(d.root, [0.013, 0.04, 0.008], [pos[0] - 0.06 + pin * 0.03, pos[1] - 0.025, pos[2] + 0.069], gold).userData.port = name;
    box(d.root, [0.04, 0.026, 0.025], [pos[0] + 0.12, pos[1] + 0.075, pos[2] + 0.045], green).userData.port = name;
    d.ports[name] = new THREE.Vector3(...pos).add(new THREE.Vector3(0, 0, 0.14));
  }
  function workstation(id: string, label: string, x: number, z: number) {
    const d = device(id, label, x, z, 2.5, 2.75);
    box(d.root, [2.7, 0.09, 1.85], [0, 0.07, 0], trim, 0.06);
    box(d.root, [0.75, 0.09, 0.5], [-0.30, 0.19, -0.35], silver, 0.04);
    box(d.root, [0.14, 0.55, 0.12], [-0.30, 0.49, -0.47], silver, 0.02);
    box(d.root, [1.88, 1.25, 0.10], [-0.30, 1.31, -0.47], black, 0.055);
    panel(d.root, id === "pc-a" ? "HOST A" : "HOST B", id === "pc-a" ? "WORKSTATION / 01" : "WORKSTATION / 02", 1.74, 1.07, [-0.30, 1.33, -0.408], true);
    cylinder(d.root, 0.018, 0.008, [-0.30, 1.9, -0.408], silver).rotation.x = Math.PI / 2;
    box(d.root, [0.50, 1.25, 0.83], [1.06, 0.78, -0.13], pale, 0.045);
    box(d.root, [0.43, 1.1, 0.025], [1.06, 0.78, 0.30], dark, 0.025);
    for (let i = 0; i < 10; i++) box(d.root, [0.30, 0.018, 0.027], [1.06, 0.42 + i * 0.041, 0.322], trim);
    port(d, `${id}:eth0`, [1.06, 1.08, 0.32]);
    box(d.root, [1.65, 0.07, 0.52], [-0.3, 0.19, 0.44], pale, 0.045);
    for (let row = 0; row < 4; row++) for (let col = 0; col < 13; col++) box(d.root, [0.092, 0.025, 0.076], [-1.015 + col * 0.116, 0.24, 0.29 + row * 0.10], dark, 0.01);
    box(d.root, [0.27, 0.10, 0.38], [0.72, 0.22, 0.49], pale, 0.065);
    return d;
  }
  function switchModel(id: string, label: string, x: number, z: number, router = false) {
    const d = device(id, label, x, z, router ? 2.6 : 2.3, router ? 1.65 : 1.20);
    box(d.root, [2.45, 0.18, 1.5], [0, 0.14, 0], black, 0.055);
    box(d.root, [2.35, router ? 0.63 : 0.36, 1.35], [0, router ? 0.49 : 0.36, 0], router ? pale : silver, 0.04);
    box(d.root, [2.30, router ? 0.5 : 0.26, 0.035], [0, router ? 0.49 : 0.36, 0.691], dark, 0.02);
    const ports = router ? ["router:ge0", "router:ge1"] : id === "sw-a" ? ["sw-a:1", "sw-a:2", "sw-a:3"] : ["sw-b:1", "sw-b:2"];
    ports.forEach((p, i) => port(d, p, [-0.64 + i * 0.36, router ? 0.45 : 0.36, 0.73]));
    const topY = router ? 0.816 : 0.546;
    for (let j = 0; j < 14; j++) box(d.root, [0.045, 0.009, 0.59], [-0.78 + j * 0.085, topY, -0.08], black);
    screws(d.root, 2.13, 1.12, topY);
    const tag = panel(d.root, router ? "ROUTER" : "SWITCH", router ? "GE0 / GE1" : "GIGABIT ETHERNET", 0.67, 0.21, [0.71, router ? 0.47 : 0.36, 0.718]);
    tag.userData.device = id;
    if (router) for (const x0 of [-1.3, 1.3]) {
      box(d.root, [0.23, 0.60, 0.1], [x0, 0.49, 0.53], trim, 0.02);
      for (const y of [0.31, 0.66]) cylinder(d.root, 0.06, 0.02, [x0, y, 0.59], black).rotation.x = Math.PI / 2;
    }
    return d;
  }
  const floorMat = mat(0x0b1c2b, 0.05, 0.85);
  box(scene, [16, 0.28, 10.4], [0, -0.23, 0], floorMat, 0.22);
  box(scene, [16.06, 0.035, 10.46], [0, -0.26, 0], mat(0x32646c, 0.6, 0.35), 0.16);
  const ground = mesh(scene, new THREE.PlaneGeometry(200, 200), mat(0x061422, 0, 1), [0, -0.40, 0]); ground.rotation.x = -Math.PI / 2; ground.castShadow = false;
  const grid = new THREE.GridHelper(15, 30, 0x28434e, 0x20333d); grid.position.y = -0.079; scene.add(grid);
  const deckTag = panel(scene, network ? "NETWORK EXPERIMENT" : course === "computer-organization" ? "COMPUTER ARCHITECTURE" : "OPERATING SYSTEMS", "XUETU  /  408 LAB", 3.4, 0.62, [-5.1, -0.065, 4.25]); deckTag.rotation.x = -Math.PI / 2;
  let heatSink: THREE.Group | undefined; let diskArm: THREE.Group | undefined;
  const frameLights: THREE.Mesh[] = [];
  const cacheLights: THREE.Mesh[] = [];
  if (network) {
    workstation("pc-a", "主机 A", -4.3, 2.0); workstation("pc-b", "主机 B", 4.3, 2.0);
    switchModel("sw-a", "交换机 S1", -3.5, -1.35); switchModel("sw-b", "交换机 S2", 3.5, -1.35);
    switchModel("router", "路由器 R1", 0, -2.0, true);
  } else {
    const pcb = box(scene, [11.4, 0.14, 6.8], [0, 0.04, 0], boardMat, 0.08);
    pcb.userData.device = "cpu";
    screws(scene, 10.9, 6.3, 0.13);
    const traceMaterial = mat(0x55765a, 0.8, 0.4);
    for (let i = 0; i < 26; i++) {
      box(scene, [4.3 + i % 3, 0.008, 0.014], [-1.8, 0.118, -2.8 + i * 0.21], traceMaterial);
      box(scene, [0.014, 0.008, 1.2 + i % 4 * 0.3], [-4.8 + i * 0.38, 0.119, 0.6], traceMaterial);
    }
    const cpu = device("cpu", "CPU · 运算与控制", -1.65, -0.8, 3.0, 2.1);
    box(cpu.root, [2.6, 0.17, 2.4], [0, 0.22, 0], black, 0.06);
    box(cpu.root, [2.25, 0.14, 2.04], [0, 0.39, 0], silver, 0.08);
    const top = panel(cpu.root, "PROCESSOR", "CONTROL / ALU / REGISTERS", 1.85, 0.58, [0, 0.469, 0.12]); top.rotation.x = -Math.PI / 2;
    for (let i = 0; i < 18; i++) for (const side of [-1, 1]) box(cpu.root, [0.11, 0.08, 0.04], [side * 1.31, 0.26, -0.9 + i * 0.105], gold);
    heatSink = new THREE.Group(); heatSink.position.y = 0.51; cpu.root.add(heatSink);
    for (let i = 0; i < 18; i++) box(heatSink, [0.049, 0.58, 1.98], [-0.94 + i * 0.11, 0.29, 0], silver);
    for (const x of [-0.54, 0.54]) {
      const pipe = mesh(heatSink, new THREE.TorusGeometry(0.65, 0.055, 10, 28, Math.PI), gold, [x, 0.10, 0]); pipe.rotation.y = Math.PI / 2;
    }
    const cacheDevice = device("cache", "Cache · 高速缓存", -1.8, 1.6, 1.9, 1.1);
    box(cacheDevice.root, [2.05, 0.13, 1.0], [0, 0.23, 0], dark, 0.025);
    for (let i = 0; i < 16; i++) for (const z of [-0.55, 0.55]) box(cacheDevice.root, [0.06, 0.05, 0.16], [-0.90 + i * 0.12, 0.21, z], silver);
    const ct = panel(cacheDevice.root, "CACHE", "SRAM / SET-ASSOCIATIVE", 1.7, 0.40, [0, 0.303, 0]); ct.rotation.x = -Math.PI / 2;
    for (let i = 0; i < 8; i++) cacheLights.push(box(cacheDevice.root, [0.16, 0.02, 0.11], [-0.78 + i * 0.22, 0.312, 0.34], mat(0x385f6a, 0.25, 0.5, true)));
    const ram = device("ram", course === "operating-systems" ? "主存 · 页框" : "主存 · DRAM", 2.1, -0.4, 3.2, 1.65);
    for (let bank = 0; bank < 4; bank++) {
      const z = -1.5 + bank * 0.82;
      box(ram.root, [2.5, 0.18, 0.15], [0, 0.24, z], black);
      box(ram.root, [2.32, 0.82, 0.08], [0, 0.71, z], boardMat, 0.025);
      for (let chip = 0; chip < 5; chip++) box(ram.root, [0.32, 0.36, 0.055], [-0.87 + chip * 0.42, 0.72, z + 0.069], dark, 0.012);
      for (const x of [-1.28, 1.28]) box(ram.root, [0.13, 0.3, 0.2], [x, 0.34, z], pale, 0.03);
      for (let led = 0; led < 2; led++) frameLights.push(box(ram.root, [0.76, 0.03, 0.11], [-0.48 + led * 0.95, 1.15, z], mat(0x39676a, 0.3, 0.4, true)));
    }
    const diskDevice = device("disk", "磁盘 · 外存", 3.85, 2.35, 2.4, 1.15);
    box(diskDevice.root, [2.45, 0.32, 1.85], [0, 0.31, 0], silver, 0.13);
    box(diskDevice.root, [2.21, 0.07, 1.60], [0, 0.49, 0], dark, 0.08);
    const platter = cylinder(diskDevice.root, 0.70, 0.05, [-0.25, 0.55, 0], silver);
    platter.material = mat(0xbdc8cc, 1, 0.13);
    for (const radius of [0.25, 0.40, 0.55, 0.67]) {
      const groove = mesh(diskDevice.root, new THREE.TorusGeometry(radius, 0.003, 5, 64), trim, [-0.25, 0.58, 0]); groove.rotation.x = Math.PI / 2;
    }
    cylinder(diskDevice.root, 0.15, 0.08, [-0.25, 0.60, 0], gold);
    diskArm = new THREE.Group(); diskArm.position.set(0.83, 0.63, 0.5); diskDevice.root.add(diskArm);
    box(diskArm, [0.90, 0.035, 0.12], [-0.36, 0, 0], pale, 0.02); cylinder(diskArm, 0.11, 0.09, [0, 0, 0], silver);
    screws(diskDevice.root, 2.19, 1.6, 0.50);
    const ioDevice = device("io", "I/O · 设备控制器", -4.35, 0.9, 1.5, 1.25);
    box(ioDevice.root, [1.5, 0.7, 1.45], [0, 0.54, 0], silver, 0.055);
    for (let i = 0; i < 3; i++) box(ioDevice.root, [0.55, 0.14, 0.05], [0, 0.40 + i * 0.20, 0.75], black);
    for (let i = 0; i < 12; i++) cylinder(scene, 0.085, 0.3, [-4.5 + i * 0.26, 0.29, -2.6], i % 2 ? silver : dark);
    if (labId === "os-disk") { controls.target.set(2.4, 0.5, 1.7); camera.position.set(8.5, 7.5, 10.5); controls.update(); controls.saveState(); }
  }
  const cables = new THREE.Group(); scene.add(cables);
  const portButtons: { button: HTMLButtonElement; device: Device; position: THREE.Vector3 }[] = [];
  devices.forEach((d, id) => Object.entries(d.ports).forEach(([name, position]) => {
    const button = document.createElement("button"); button.type = "button"; button.className = "vl-port-hit"; button.dataset.port = name;
    button.title = `${d.label} · ${name.split(":")[1]?.toUpperCase()}`;
    button.setAttribute("aria-label", `选择网口 ${button.title}`);
    button.addEventListener("click", () => onSelect(id, name)); labels.appendChild(button);
    portButtons.push({ button, device: d, position });
  }));
  const wireMeshes: { mesh: THREE.Mesh; a: string; b: string }[] = [];
  let currentLinks = "__initial__";
  function disposeGroup(group: THREE.Group) {
    group.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach((m) => m.dispose()); } }); group.clear();
  }
  function rebuildCables(linkText: string) {
    if (!network || currentLinks === linkText) return;
    currentLinks = linkText; disposeGroup(cables); wireMeshes.length = 0;
    scene.updateMatrixWorld(true);
    let links: [string, string][] = [];
    try { links = parseLinks(linkText); } catch { return; }
    for (const [a, b] of links) {
      const da = devices.get(a.split(":")[0]!); const db = devices.get(b.split(":")[0]!);
      if (!da?.ports[a] || !db?.ports[b]) continue;
      const start = da.root.localToWorld(da.ports[a]!.clone()); const end = db.root.localToWorld(db.ports[b]!.clone());
      const curve = new THREE.CatmullRomCurve3([start, start.clone().add(new THREE.Vector3(0, -0.08, 0.30)), new THREE.Vector3(start.x, 0.12, start.z + 0.6), new THREE.Vector3(end.x, 0.12, end.z + 0.6), end.clone().add(new THREE.Vector3(0, -0.08, 0.3)), end]);
      const material = new THREE.MeshStandardMaterial({ color: 0x497684, metalness: 0.25, roughness: 0.48 });
      const wire = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.041, 8, false), material); wire.castShadow = true; cables.add(wire); wireMeshes.push({ mesh: wire, a: da.root.userData.device as string, b: db.root.userData.device as string });
      for (const endpoint of [start, end]) {
        const plug = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.10, 0.22), new THREE.MeshStandardMaterial({ color: 0x8dafbd, transparent: true, opacity: 0.8 })); plug.position.copy(endpoint); cables.add(plug);
      }
    }
  }
  const packet = mesh(scene, new THREE.SphereGeometry(0.095, 14, 10), green, [0, 0, 0]); packet.visible = false;
  const packetPathGroup = new THREE.Group(); scene.add(packetPathGroup);
  let packetCurve: THREE.CatmullRomCurve3 | null = null;
  let state: SceneState = { selected: "", links: "", event: null, playing: false, exploded: false };
  let previousEvent: LabEvent | null = null;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function update(next: SceneState) {
    state = next; rebuildCables(next.links);
    devices.forEach((d, id) => {
      d.ring.visible = id === next.selected || !!next.event?.active.includes(id);
      d.badge.dataset.selected = String(id === next.selected);
      d.badge.dataset.active = String(!!next.event?.active.includes(id));
      d.badge.setAttribute("aria-pressed", String(id === next.selected));
    });
    if (heatSink) heatSink.position.y = next.exploded ? 2.15 : 0.51;
    if (diskArm) { const track = Number(next.event?.metrics.find((m) => m.label === "当前磁道")?.value ?? 53); diskArm.rotation.y = -0.2 + track / 199 * 0.9; }
    [...frameLights, ...cacheLights].forEach((light) => {
      const i = labId === "co-cache" ? cacheLights.indexOf(light) : labId === "os-pages" ? frameLights.indexOf(light) : -1;
      const cell = i >= 0 ? next.event?.cells?.[i] : undefined; const material = light.material as THREE.MeshStandardMaterial;
      const color = cell?.state === "miss" ? 0xe8b669 : cell?.state ? colors.green : 0x385f6a;
      material.color.setHex(color); material.emissive.setHex(color); material.emissiveIntensity = cell?.state ? 0.55 : 0.12;
    });
    const path = next.event?.path ?? [];
    wireMeshes.forEach(({ mesh: wire, a, b }) => {
      const active = path.some((id, i) => id === a && path[i + 1] === b || id === b && path[i + 1] === a);
      const material = wire.material as THREE.MeshStandardMaterial; material.color.setHex(active ? colors.green : 0x497684); material.emissive.setHex(active ? 0x22674e : 0x000000);
    });
    if (previousEvent !== next.event) {
      previousEvent = next.event; disposeGroup(packetPathGroup); packetCurve = null;
      const points = path.map((id) => devices.get(id)?.root.position.clone().add(new THREE.Vector3(0, 1.2, 0))).filter((p): p is THREE.Vector3 => !!p);
      if (points.length > 1) {
        packetCurve = new THREE.CatmullRomCurve3(points);
        const line = new THREE.Mesh(new THREE.TubeGeometry(packetCurve, 64, 0.012, 6, false), new THREE.MeshBasicMaterial({ color: colors.green, transparent: true, opacity: 0.45 })); packetPathGroup.add(line);
      }
      packet.visible = !!packetCurve;
    }
  }
  const raycaster = new THREE.Raycaster(); const pointer = new THREE.Vector2(); let down = { x: 0, y: 0 };
  const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
  const onUp = (e: PointerEvent) => {
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
    const rect = renderer.domElement.getBoundingClientRect(); pointer.set((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects([...devices.values()].map((d) => d.root), true).find((r) => r.object.visible && r.object instanceof THREE.Mesh && !(r.object.geometry instanceof THREE.RingGeometry));
    if (!hit) return;
    let object: THREE.Object3D | null = hit.object; let selectedPort: string | undefined; let id: string | undefined;
    while (object) { selectedPort ??= object.userData.port as string | undefined; id ??= object.userData.device as string | undefined; object = object.parent; }
    if (id) onSelect(id, selectedPort);
  };
  const onKey = (e: KeyboardEvent) => {
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "-"].includes(e.key)) {
      e.preventDefault();
      const offset = camera.position.clone().sub(controls.target); const spherical = new THREE.Spherical().setFromVector3(offset);
      if (e.key === "ArrowLeft") spherical.theta -= 0.12; if (e.key === "ArrowRight") spherical.theta += 0.12;
      if (e.key === "ArrowUp") spherical.phi = Math.max(0.18, spherical.phi - 0.1); if (e.key === "ArrowDown") spherical.phi = Math.min(Math.PI / 2.12, spherical.phi + 0.1);
      if (e.key === "+") spherical.radius = Math.max(7, spherical.radius * 0.9); if (e.key === "-") spherical.radius = Math.min(30, spherical.radius * 1.1);
      camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical)); controls.update();
    }
  };
  renderer.domElement.addEventListener("pointerdown", onDown); renderer.domElement.addEventListener("pointerup", onUp); renderer.domElement.addEventListener("keydown", onKey);
  const basePosition = camera.position.clone(); const baseTarget = controls.target.clone(); let fitScale = 1;
  const observer = new ResizeObserver(() => {
    const { width, height } = host.getBoundingClientRect(); if (!width || !height) return;
    const nextScale = Math.max(1, 1.55 / (width / height));
    camera.position.sub(controls.target).multiplyScalar(nextScale / fitScale).add(controls.target);
    fitScale = nextScale; controls.minDistance = 7 * fitScale; controls.maxDistance = 30 * fitScale;
    renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); controls.update();
  }); observer.observe(host);
  let animation = 0; let stopped = false; const started = performance.now(); const projected = new THREE.Vector3();
  function draw(now: number) {
    if (stopped) return;
    controls.update();
    if (packetCurve) packet.position.copy(packetCurve.getPoint(state.playing && !reducedMotion ? ((now - started) / 2400) % 1 : 0.65));
    const width = host.clientWidth; const height = host.clientHeight;
    const placed: { x: number; y: number; w: number }[] = [];
    devices.forEach((d) => {
      projected.copy(d.anchor).project(camera);
      const w = d.badge.offsetWidth;
      const x = THREE.MathUtils.clamp((projected.x * 0.5 + 0.5) * width, w / 2 + 8, width - w / 2 - 8);
      let y = Math.max(70, (-projected.y * 0.5 + 0.5) * height);
      for (let attempts = 0; attempts < 5 && placed.some((p) => Math.abs(p.x - x) < (p.w + w) / 2 + 5 && Math.abs(p.y - y) < 29); attempts++) y -= 31;
      placed.push({ x, y, w });
      d.badge.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
      d.badge.hidden = projected.z > 1 || projected.z < -1;
    });
    portButtons.forEach(({ button, device: d, position }) => {
      projected.copy(position); d.root.localToWorld(projected); projected.project(camera);
      button.hidden = d.root.userData.device !== state.selected || projected.z > 1 || projected.z < -1;
      button.style.transform = `translate(${(projected.x * 0.5 + 0.5) * width}px, ${(-projected.y * 0.5 + 0.5) * height}px) translate(-50%, -50%)`;
    });
    renderer.render(scene, camera); animation = requestAnimationFrame(draw);
  }
  animation = requestAnimationFrame(draw);
  return {
    update,
    reset() { controls.target.copy(baseTarget); camera.position.copy(basePosition).sub(baseTarget).multiplyScalar(fitScale).add(baseTarget); controls.update(); },
    zoom(factor) { const offset = camera.position.clone().sub(controls.target); offset.setLength(THREE.MathUtils.clamp(offset.length() * factor, controls.minDistance, controls.maxDistance)); camera.position.copy(controls.target).add(offset); controls.update(); },
    dispose() {
      stopped = true; cancelAnimationFrame(animation); observer.disconnect(); controls.dispose();
      renderer.domElement.removeEventListener("pointerdown", onDown); renderer.domElement.removeEventListener("pointerup", onUp); renderer.domElement.removeEventListener("keydown", onKey);
      disposeGroup(cables); disposeGroup(packetPathGroup);
      geometries.forEach((g) => g.dispose()); materials.forEach((m) => m.dispose()); textures.forEach((tex) => tex.dispose());
      grid.geometry.dispose(); (Array.isArray(grid.material) ? grid.material : [grid.material]).forEach((m) => m.dispose());
      env.dispose(); renderer.dispose(); renderer.domElement.remove(); devices.forEach((d) => d.badge.remove()); portButtons.forEach(({ button }) => button.remove()); scene.clear();
    },
  };
}

import * as THREE from "three";

function ellipsoid(parent: THREE.Object3D, material: THREE.Material, position: [number, number, number], scale: [number, number, number]) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), material);
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  parent.add(mesh);
  return mesh;
}

function stroke(parent: THREE.Object3D, material: THREE.Material, points: THREE.Vector3[], radius: number) {
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 24, radius, 8), material);
  parent.add(mesh);
  return mesh;
}

export function mountAgentAvatar(container: HTMLElement) {
  if (!container.clientWidth || !container.clientHeight) return () => {};
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.setAttribute("aria-hidden", "true");
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1.5, 1.5, 1.65, -1.65, 0.1, 20);
  camera.position.set(0, 0.06, 6);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x6eafa3, 2.3));
  const key = new THREE.DirectionalLight(0xffffff, 2.1);
  key.position.set(-3, 5, 6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x70e8dc, 1.9);
  rim.position.set(3, 2, -2);
  scene.add(rim);

  const pearl = new THREE.MeshStandardMaterial({ color: 0xe9f4f0, metalness: 0.18, roughness: 0.32 });
  const porcelain = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.06, roughness: 0.28 });
  const teal = new THREE.MeshStandardMaterial({ color: 0x12665d, metalness: 0.32, roughness: 0.34 });
  const deep = new THREE.MeshStandardMaterial({ color: 0x123b42, metalness: 0.4, roughness: 0.27 });
  const visor = new THREE.MeshStandardMaterial({ color: 0x163c43, metalness: 0.34, roughness: 0.25 });
  const glow = new THREE.MeshStandardMaterial({ color: 0x99f3df, emissive: 0x32bfa8, emissiveIntensity: 1.8, roughness: 0.25 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xeab971, metalness: 0.62, roughness: 0.26 });
  const materials = [pearl, porcelain, teal, deep, visor, glow, brass];
  const figure = new THREE.Group();
  scene.add(figure);

  // The headset and book badge keep the teaching role legible at launcher size.
  ellipsoid(figure, deep, [0, -1.26, -0.17], [0.81, 0.83, 0.44]);
  ellipsoid(figure, teal, [-0.58, -1.21, -0.01], [0.33, 0.68, 0.37]).rotation.z = -0.19;
  ellipsoid(figure, teal, [0.58, -1.21, -0.01], [0.33, 0.68, 0.37]).rotation.z = 0.19;
  ellipsoid(figure, pearl, [0, -1.18, 0.2], [0.49, 0.64, 0.3]);
  ellipsoid(figure, teal, [0, -0.45, -0.04], [0.18, 0.2, 0.18]);
  for (const side of [-1, 1]) {
    const page = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.24, 0.025), porcelain);
    page.position.set(side * 0.105, -1.18, 0.487);
    page.rotation.z = side * 0.17;
    figure.add(page);
    stroke(figure, brass, [
      new THREE.Vector3(0, -1.31, 0.51),
      new THREE.Vector3(side * 0.11, -1.28, 0.51),
      new THREE.Vector3(side * 0.2, -1.3, 0.49),
    ], 0.014);
  }

  const head = new THREE.Group();
  head.position.y = 0.42;
  figure.add(head);
  ellipsoid(head, deep, [0, 0.01, -0.1], [0.61, 0.71, 0.42]);
  ellipsoid(head, pearl, [0, 0.07, 0.06], [0.58, 0.68, 0.43]);
  ellipsoid(head, porcelain, [0, -0.08, 0.24], [0.51, 0.49, 0.36]);
  ellipsoid(head, visor, [0, 0.1, 0.34], [0.49, 0.235, 0.32]);
  ellipsoid(head, pearl, [0, 0.58, 0.15], [0.35, 0.065, 0.22]);

  const eyes: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    const eye = ellipsoid(head, glow, [side * 0.215, 0.1, 0.645], [0.105, 0.048, 0.025]);
    eyes.push(eye);
    ellipsoid(head, brass, [side * 0.603, -0.02, 0.025], [0.077, 0.23, 0.19]);
    ellipsoid(head, teal, [side * 0.66, -0.02, 0.045], [0.066, 0.17, 0.145]);
    ellipsoid(head, glow, [side * 0.709, -0.02, 0.066], [0.012, 0.065, 0.065]);
  }
  stroke(head, teal, [
    new THREE.Vector3(-0.18, -0.205, 0.571),
    new THREE.Vector3(0, -0.245, 0.6),
    new THREE.Vector3(0.18, -0.205, 0.571),
  ], 0.012);
  stroke(head, brass, [
    new THREE.Vector3(0.65, -0.08, 0.08),
    new THREE.Vector3(0.67, -0.32, 0.19),
    new THREE.Vector3(0.46, -0.41, 0.37),
  ], 0.018);
  ellipsoid(head, glow, [0.45, -0.41, 0.38], [0.045, 0.04, 0.04]);

  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  let animation = 0;
  let disposed = false;
  const start = performance.now();
  const draw = (time: number) => {
    if (disposed) return;
    const t = (time - start) / 1000;
    if (!reducedMotion?.matches) {
      figure.position.y = Math.sin(t * 1.65) * 0.035;
      head.rotation.y = Math.sin(t * 0.8) * 0.095;
      head.rotation.z = Math.sin(t * 0.72) * 0.018;
      const blink = Math.sin(t * 1.8) > 0.997 ? 0.16 : 1;
      eyes.forEach((eye) => { eye.scale.y = 0.048 * blink; });
      glow.emissiveIntensity = 1.6 + Math.sin(t * 2.2) * 0.25;
    }
    renderer.render(scene, camera);
    animation = window.requestAnimationFrame(draw);
  };
  const resize = () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    const compact = w <= 64;
    const halfHeight = compact ? 1.12 : 1.7;
    camera.left = -halfHeight * w / h;
    camera.right = halfHeight * w / h;
    camera.top = halfHeight + (compact ? 0.35 : 0);
    camera.bottom = -halfHeight + (compact ? 0.35 : 0);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  };
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  draw(start);
  return () => {
    disposed = true;
    window.cancelAnimationFrame(animation);
    observer.disconnect();
    scene.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
    });
    materials.forEach((material) => material.dispose());
    renderer.dispose();
    renderer.domElement.remove();
  };
}

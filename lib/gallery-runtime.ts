import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createMarker, type ViewerViewport } from '@/components/tapestry-viewer';
import { selectorCenter, type Annotation, type Scene } from '@/lib/tapestry-schema';
import { updateAutoPreview } from '@/lib/auto-preview';
import { cameraFromPose, clamp, poseFromCamera, TEXTILE, tileLayout, visibleTiles, type GalleryPose } from '@/lib/gallery-math';

type Options = {
  host: HTMLElement;
  dziUrl: string;
  initialCamera: ViewerViewport;
  reduceMotion: boolean;
  signal: AbortSignal;
  onMove: (camera: ViewerViewport) => void;
  onManual: () => void;
  onTap: () => void;
  onError: (message: string) => void;
};
type Tile = { mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>; bitmap: ImageBitmap };
type Transition = { from: GalleryPose; to: GalleryPose; start: number; duration: number; complete?: () => void };

/** Lazy, bounded camera and texture renderer. It never requests the master scan. */
export async function createGallery(options: Options) {
  const { host, signal } = options;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0xf7f6f3);
  renderer.domElement.setAttribute('aria-label', 'Interactive 3D gallery. Drag to move along the case. Scroll or pinch to zoom. Shift-drag to orbit. Arrow keys move; plus and minus zoom.');
  renderer.domElement.tabIndex = 0;
  host.insertBefore(renderer.domElement, host.firstChild);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.03, 400);
  const hemisphere = new THREE.HemisphereLight(0xffffff, 0xc3b9a8, 2.3);
  const sun = new THREE.DirectionalLight(0xffffff, 2.1);
  sun.position.set(-12, 18, 8);
  scene.add(hemisphere, sun);
  let disposed = false, dirty = true, frame = 0, width = 1, height = 1;
  let moving = false, speed = 28, reduced = options.reduceMotion;
  let exiting = false;
  const pose = poseFromCamera(options.initialCamera);
  let flatWidth = pose.width;
  let transition: Transition | null = null;
  let lastTime = 0, lastReport = 0, lastTiles = 0;
  let tileRefreshPending = true;
  let activeNote: string | undefined;
  const tileGroup = new THREE.Group();
  const modelGroup = new THREE.Group();
  scene.add(modelGroup, tileGroup);
  const tiles = new Map<string, Tile>();
  const inFlight = new Set<string>();
  const failed = new Set<string>();
  const baseKeys = visibleTiles(0.5, 70, 600).filter((key) => key.startsWith('13/'));
  let wanted = new Set(baseKeys);
  let queue: string[] = [];
  let jobs = 0;
  let imageWarning = false;
  const abort = new AbortController();
  let markers: { element: HTMLElement; point: THREE.Vector3 }[] = [];
  const pointers = new Map<number, { x: number; y: number }>();
  let dragDistance = 0;
  let model: THREE.Object3D | null = null;

  const disposeObject = (object: THREE.Object3D) => object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    for (const material of Array.isArray(child.material) ? child.material : [child.material]) material.dispose();
  });
  const dropTile = (key: string) => {
    const tile = tiles.get(key);
    if (!tile) return;
    tileGroup.remove(tile.mesh);
    tile.mesh.geometry.dispose();
    tile.mesh.material.map?.dispose();
    tile.mesh.material.dispose();
    tile.bitmap.close();
    tiles.delete(key);
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    abort.abort();
    signal.removeEventListener('abort', dispose);
    window.cancelAnimationFrame(frame);
    resize.disconnect();
    pointers.clear();
    markers.forEach(({ element }) => element.remove());
    Array.from(tiles.keys()).forEach(dropTile);
    if (model) disposeObject(model);
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  };
  const resize = new ResizeObserver(() => {
    width = Math.max(1, host.clientWidth); height = Math.max(1, host.clientHeight);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    dirty = true;
  });
  resize.observe(host);
  signal.addEventListener('abort', dispose, { once: true });
  if (signal.aborted) { dispose(); throw new DOMException('Cancelled', 'AbortError'); }

  async function loadTile(key: string) {
    const [levelString, coordinates] = key.split('/');
    const [col, row] = coordinates.split('_').map(Number);
    const level = Number(levelString);
    const response = await fetch(`${options.dziUrl.replace(/\.dzi(?:\?.*)?$/, '_files')}/${key}.webp`, { signal: abort.signal });
    if (!response.ok) throw new Error('Tile unavailable');
    const bitmap = await createImageBitmap(await response.blob(), { imageOrientation: 'flipY', colorSpaceConversion: 'none' });
    if (disposed || !wanted.has(key)) { bitmap.close(); return; }
    const layout = tileLayout(level, col, row);
    const texture = new THREE.Texture(bitmap);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    const geometry = new THREE.PlaneGeometry(layout.width * TEXTILE.width, layout.height * TEXTILE.depth);
    const uv = geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) ? layout.u1 : layout.u0, uv.getY(i) ? layout.v1 : layout.v0);
    const material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set((layout.x + layout.width / 2 - 0.5) * TEXTILE.width,
      TEXTILE.y + (level - 13) * 0.0001, (layout.y + layout.height / 2 - 0.5) * TEXTILE.depth);
    tileGroup.add(mesh);
    tiles.set(key, { mesh, bitmap });
    dirty = true;
  }
  const pump = () => {
    while (!disposed && jobs < 4 && queue.length) {
      const key = queue.shift()!;
      if (!wanted.has(key) || tiles.has(key) || inFlight.has(key) || failed.has(key)) continue;
      jobs++; inFlight.add(key);
      void loadTile(key).catch((error: unknown) => {
        failed.add(key);
        if (!disposed && !(error instanceof DOMException && error.name === 'AbortError') && !imageWarning) {
          imageWarning = true;
          options.onError('Some gallery tiles are unavailable. Bird’s-eye remains available; retry the gallery to reload.');
        }
      }).finally(() => { jobs--; inFlight.delete(key); pump(); });
    }
  };
  const requestTiles = () => {
    const detail = visibleTiles(pose.center, pose.width, width * renderer.getPixelRatio());
    wanted = new Set([...baseKeys, ...detail]);
    for (const key of tiles.keys()) if (!wanted.has(key)) dropTile(key);
    queue = [...detail, ...baseKeys].filter((key) => !tiles.has(key) && !inFlight.has(key));
    pump();
  };
  const animateTo = (to: GalleryPose, duration: number, complete?: () => void) => {
    transition = { from: { ...pose }, to, duration: reduced ? 0 : duration, start: performance.now(), complete };
    dirty = true;
  };
  const flatCamera = () => cameraFromPose({ ...pose, width: flatWidth, tilt: 0, yaw: 0 }, camera.aspect);
  const report = () => options.onMove(flatCamera());
  const manual = () => { moving = false; transition = null; options.onManual(); dirty = true; };
  const zoom = (factor: number) => {
    if (exiting) return;
    manual();
    const previousWidth = pose.width;
    pose.width = clamp(pose.width * factor, 0.4, 100);
    flatWidth = clamp(flatWidth * pose.width / previousWidth, 0.15, 70);
    report();
  };

  const canvas = renderer.domElement;
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    if (!disposed) options.onError('The 3D graphics session was interrupted. Switch to Bird’s-eye or reopen Gallery.');
  });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  canvas.addEventListener('pointerdown', (event) => {
    if (transition) return;
    manual(); canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 1) dragDistance = 0;
  });
  canvas.addEventListener('pointermove', (event) => {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    const dx = event.clientX - previous.x, dy = event.clientY - previous.y;
    dragDistance += Math.abs(dx) + Math.abs(dy);
    const other = Array.from(pointers.entries()).find(([id]) => id !== event.pointerId)?.[1];
    if (other) {
      const before = Math.hypot(previous.x - other.x, previous.y - other.y);
      const after = Math.hypot(event.clientX - other.x, event.clientY - other.y);
      if (before > 5 && after > 5) zoom(before / after);
    } else if (event.shiftKey || event.buttons === 2) {
      pose.yaw = clamp(pose.yaw - dx * 0.004, -0.8, 0.8);
      pose.tilt = clamp(pose.tilt + dy * 0.004, 0.08, 1.15);
    } else {
      pose.center = clamp(pose.center - dx / width * pose.width / TEXTILE.width, 0, 1);
      pose.tilt = clamp(pose.tilt + dy * 0.003, 0.08, 1.15);
    }
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    dirty = true;
  });
  const endPointer = (event: PointerEvent) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    report();
    if (event.type === 'pointerup' && dragDistance < 5) options.onTap();
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('wheel', (event) => { event.preventDefault(); if (!transition) zoom(Math.exp(clamp(event.deltaY, -100, 100) * 0.0025)); }, { passive: false });
  canvas.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (exiting) return;
    manual();
    if (event.key === '+' || event.key === '=') zoom(0.8);
    else if (event.key === '-') zoom(1.25);
    else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') pose.tilt = clamp(pose.tilt + (event.key === 'ArrowUp' ? -0.12 : 0.12), 0.08, 1.15);
    else pose.center = clamp(pose.center + (event.key === 'ArrowRight' ? 1 : -1) * pose.width / 70 * 0.12, 0, 1);
    report();
  });

  const point = new THREE.Vector3();
  const target = new THREE.Vector3();
  const draw = (time: number) => {
    if (disposed) return;
    frame = requestAnimationFrame(draw);
    const dt = document.hidden ? 0 : Math.min((time - lastTime) / 1000, 0.05);
    lastTime = time;
    if (document.hidden) return;
    if (transition) {
      const current = transition;
      const progress = current.duration === 0 ? 1 : clamp((time - current.start) / current.duration, 0, 1);
      const ease = progress * progress * (3 - 2 * progress);
      for (const key of ['center', 'v', 'width', 'tilt', 'yaw'] as const) pose[key] = THREE.MathUtils.lerp(current.from[key], current.to[key], ease);
      dirty = true;
      if (progress === 1) { transition = null; current.complete?.(); }
    } else if (moving) {
      pose.center = clamp(pose.center + speed / width * pose.width / 70 * dt, 0, 1);
      dirty = true;
      if (pose.center >= 1) { moving = false; options.onManual(); }
    }
    if (!dirty && !moving) {
      if (tileRefreshPending && time - lastTiles >= 200) {
        requestTiles(); lastTiles = time; tileRefreshPending = false;
      }
      return;
    }
    target.set((pose.center - 0.5) * 70, TEXTILE.y, (pose.v - 0.5) * TEXTILE.depth);
    const distance = pose.width / camera.aspect / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    const far = Math.max(400, distance + 200);
    if (camera.far !== far) { camera.far = far; camera.updateProjectionMatrix(); }
    const direction = new THREE.Vector3(Math.sin(pose.yaw) * Math.sin(pose.tilt), Math.cos(pose.tilt), Math.cos(pose.yaw) * Math.sin(pose.tilt));
    camera.position.copy(target).addScaledVector(direction, distance);
    camera.up.set(0, 0, -1);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    renderer.render(scene, camera);
    for (const marker of markers) {
      point.copy(marker.point).project(camera);
      const visible = !transition && point.z > -1 && point.z < 1 && Math.abs(point.x) < 1.03 && Math.abs(point.y) < 0.96;
      marker.element.hidden = !visible;
      marker.element.style.left = `${(point.x + 1) * width / 2}px`;
      marker.element.style.top = `${(1 - point.y) * height / 2}px`;
    }
    updateAutoPreview(host, moving && !activeNote && !transition);
    if (time - lastReport > 250 && !transition) { report(); lastReport = time; }
    if (time - lastTiles >= 200) { requestTiles(); lastTiles = time; tileRefreshPending = false; }
    else tileRefreshPending = true;
    dirty = false;
  };

  try {
    const response = await fetch('/gallery/bayeux-gallery.glb', { signal: abort.signal });
    if (!response.ok) throw new Error('The gallery model could not be loaded.');
    const result = await new GLTFLoader().parseAsync(await response.arrayBuffer(), '');
    if (disposed) { disposeObject(result.scene); throw new DOMException('Cancelled', 'AbortError'); }
    model = result.scene;
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const material = object.material as THREE.MeshStandardMaterial;
      if (material.name.includes('glazing')) { material.depthWrite = false; material.opacity = 0.045; }
    });
    modelGroup.add(model);
    width = Math.max(1, host.clientWidth); height = Math.max(1, host.clientHeight);
    camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height);
    requestTiles();
    animateTo({ ...pose, width: Math.max(3.5, pose.width * 1.7), v: clamp(pose.v, 0, 1), tilt: 0.88, yaw: -0.24 }, 1150);
    frame = requestAnimationFrame(draw);
  } catch (error) { dispose(); throw error; }

  return {
    dispose,
    setPlayback(playing: boolean, nextSpeed: number) { moving = playing && !exiting; speed = nextSpeed; dirty = true; },
    setReducedMotion(value: boolean) { reduced = value; },
    setAnnotations(chapter: Scene | null, selected: string | undefined, onActivate: (annotation: Annotation, trigger: HTMLElement) => void) {
      activeNote = selected;
      markers.forEach(({ element }) => element.remove());
      markers = (chapter?.annotations ?? []).map((annotation, index) => {
        const center = selectorCenter(annotation);
        const u = (chapter!.pixelBounds.x + center.x * chapter!.pixelBounds.width) / TEXTILE.pixels;
        const element = createMarker(annotation, index, selected === annotation.id, center.x, onActivate);
        element.classList.add('gallery-marker');
        element.hidden = true;
        host.appendChild(element);
        return { element, point: new THREE.Vector3((u - 0.5) * 70, TEXTILE.y + 0.01, (center.y - 0.5) * TEXTILE.depth) };
      });
      dirty = true;
    },
    jump(center: number) { if (exiting) return; moving = false; animateTo({ ...pose, center, v: 0.5 }, 850); },
    zoom,
    exit(prepare: (rect: ViewerViewport) => void, done: () => void) {
      exiting = true;
      moving = false;
      const rect = flatCamera();
      prepare(rect);
      animateTo({ ...pose, width: flatWidth, tilt: 0, yaw: 0 }, 1000, done);
    },
  };
}

export type GalleryController = Awaited<ReturnType<typeof createGallery>>;

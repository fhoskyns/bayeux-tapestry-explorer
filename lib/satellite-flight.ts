/** Real, georeferenced imagery on a sphere; no map service or invented geography. */
export const FLIGHT_DURATION = 2600;
export const MUSEUM_LOCATION = { longitude: -0.1269, latitude: 51.5195 };

type SatelliteLayer = { url: string; bounds: readonly [number, number, number, number] };

export const SATELLITE_LAYERS: readonly SatelliteLayer[] = [
  { url: '/arrival/earth.jpg', bounds: [-180, -90, 180, 90] },
  { url: '/arrival/britain.jpg', bounds: [-15, 45, 10, 65] },
  { url: '/arrival/england.jpg', bounds: [-3.2, 49.5, 2.8, 53.5] },
  { url: '/arrival/london.jpg', bounds: [-0.3769, 51.2695, 0.1231, 51.7695] },
  { url: '/arrival/bloomsbury.jpg', bounds: [-0.1415, 51.5101, -0.1124, 51.5215] },
  { url: '/arrival/museum.jpg', bounds: [-0.1303, 51.5174, -0.1235, 51.5216] },
];

export function flightAltitude(progress: number, aspect = 1) {
  const t = Math.max(0, Math.min(1, (progress - 0.035) / 0.84));
  const eased = t * t * (3 - 2 * t);
  const globeRadius = 0.74 * Math.min(1, Math.max(0.2, aspect));
  const start = Math.max(18_000_000, 6371008.8 * (Math.sqrt(1 + (1 / (0.48 * globeRadius)) ** 2) - 1));
  return Math.exp(Math.log(start) * (1 - eased) + Math.log(360) * eased);
}

export function satelliteUvMapping(bounds: SatelliteLayer['bounds']) {
  const [west, south, east, north] = bounds;
  return [
    (MUSEUM_LOCATION.longitude - west) / (east - west),
    (MUSEUM_LOCATION.latitude - south) / (north - south),
    (180 / Math.PI) / (east - west),
    (180 / Math.PI) / (north - south),
  ];
}

/** Reveal detail only once its geographic coverage approaches the viewport. */
export function satelliteLayerOpacity(bounds: SatelliteLayer['bounds'], altitude: number, aspect: number) {
  const [u, v, longitudeScale, latitudeScale] = satelliteUvMapping(bounds);
  const latitudeSpan = Math.max(1, altitude) * 0.48 / 6371008.8;
  const longitudeSpan = latitudeSpan * Math.max(0.1, aspect) / Math.cos(MUSEUM_LOCATION.latitude * Math.PI / 180);
  const coverage = Math.min(
    Math.min(u, 1 - u) / (longitudeScale * longitudeSpan),
    Math.min(v, 1 - v) / (latitudeScale * latitudeSpan),
  );
  const t = Math.max(0, Math.min(1, (coverage - 0.7) / 0.7));
  return t * t * (3 - 2 * t);
}

const vertexSource = `
attribute vec2 position;
varying vec2 screen;
void main() { screen = position; gl_Position = vec4(position, 0.0, 1.0); }
`;

const fragmentSource = `
precision highp float;
varying vec2 screen;
uniform float altitude;
uniform float aspect;
uniform vec2 originLatitude;
uniform float originLatitudeRadians;
uniform sampler2D imagery0;
uniform sampler2D imagery1;
uniform sampler2D imagery2;
uniform sampler2D imagery3;
uniform sampler2D imagery4;
uniform sampler2D imagery5;
uniform vec4 mapping0;
uniform vec4 mapping1;
uniform vec4 mapping2;
uniform vec4 mapping3;
uniform vec4 mapping4;
uniform vec4 mapping5;
uniform float detailOpacity[5];

vec4 region(sampler2D imagery, vec4 mapping, vec2 delta) {
  vec2 uv = mapping.xy + delta * mapping.zw;
  float edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
  if (edge <= 0.0) return vec4(0.0);
  return vec4(texture2D(imagery, uv).rgb, smoothstep(0.0, 0.15, edge));
}

void main() {
  // Intersect in museum-local coordinates. The stable root preserves sub-metre
  // precision at roof height instead of subtracting Earth-scale float values.
  float h = altitude / 6371008.8;
  vec3 ray = normalize(vec3(screen.x * aspect * 0.48, screen.y * 0.48, -1.0));
  float b = (1.0 + h) * ray.z;
  float c = h * (2.0 + h);
  float discriminant = b * b - c;
  if (discriminant < 0.0) { gl_FragColor = vec4(1.0); return; }
  float t = c / (-b + sqrt(discriminant));
  vec3 p = vec3(ray.xy * t, 1.0 + (h + ray.z * t));
  float s = originLatitude.x;
  float co = originLatitude.y;
  float q = co * p.z - s * p.y;
  float horizontal = length(vec2(p.x, q));
  float dlon = horizontal < 0.000000000001 ? 0.0 : atan(p.x, q);
  float dlat;
  if (q > 0.0) {
    float k = p.x * p.x / (horizontal + q);
    dlat = atan(p.y - s * k, p.z + co * k);
  } else {
    dlat = atan(s * p.z + co * p.y, horizontal) - originLatitudeRadians;
  }
  vec2 delta = vec2(dlon, dlat);
  vec2 worldUv = mapping0.xy + delta * mapping0.zw;
  worldUv.x = fract(worldUv.x);
  vec3 color = texture2D(imagery0, worldUv).rgb;
  vec4 detail = region(imagery1, mapping1, delta);
  color = mix(color, detail.rgb, detail.a * detailOpacity[0]);
  detail = region(imagery2, mapping2, delta);
  color = mix(color, detail.rgb, detail.a * detailOpacity[1]);
  detail = region(imagery3, mapping3, delta);
  color = mix(color, detail.rgb, detail.a * detailOpacity[2]);
  detail = region(imagery4, mapping4, delta);
  color = mix(color, detail.rgb, detail.a * detailOpacity[3]);
  detail = region(imagery5, mapping5, delta);
  color = mix(color, detail.rgb, detail.a * detailOpacity[4]);
  // Gentle spherical lighting disappears at ground scale.
  color *= mix(0.78, 1.0, max(0.0, p.z / length(p)));
  gl_FragColor = vec4(color, 1.0);
}
`;

export type SatelliteFlight = { draw: (progress: number) => void; dispose: () => void };

export async function createSatelliteFlight(canvas: HTMLCanvasElement, signal: AbortSignal): Promise<SatelliteFlight | null> {
  let gl: WebGLRenderingContext | null;
  try { gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, powerPreference: 'low-power' }); }
  catch { return null; }
  if (!gl) return null;
  gl.clearColor(1, 1, 1, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  const shaders: WebGLShader[] = [];
  const textures: WebGLTexture[] = [];
  const program = gl.createProgram();
  const buffer = gl.createBuffer();
  const images: HTMLImageElement[] = [];
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const image of images) { image.onload = null; image.onerror = null; image.removeAttribute('src'); }
    for (const texture of textures) gl.deleteTexture(texture);
    for (const shader of shaders) gl.deleteShader(shader);
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
    signal.removeEventListener('abort', dispose);
  };
  signal.addEventListener('abort', dispose, { once: true });
  if (signal.aborted || !program || !buffer) { dispose(); return null; }

  try {
    for (const [type, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]] as const) {
      const shader = gl.createShader(type);
      if (!shader) throw new Error('Satellite renderer unavailable');
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('Satellite shader unavailable');
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Satellite renderer unavailable');
    const loaded = await Promise.all(SATELLITE_LAYERS.map((layer) => new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      images.push(image);
      const cleanup = () => { signal.removeEventListener('abort', aborted); image.onload = null; image.onerror = null; };
      const aborted = () => { cleanup(); reject(new Error('Satellite loading cancelled')); };
      image.onload = () => { cleanup(); resolve(image); };
      image.onerror = () => { cleanup(); reject(new Error('Satellite imagery unavailable')); };
      signal.addEventListener('abort', aborted, { once: true });
      image.src = layer.url;
    })));
    if (disposed) return null;
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    const maximumTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    loaded.forEach((image, index) => {
      const texture = gl.createTexture();
      if (!texture) throw new Error('Satellite texture unavailable');
      textures.push(texture);
      gl.activeTexture(gl.TEXTURE0 + index);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      let source: HTMLImageElement | HTMLCanvasElement = image;
      if (image.width > maximumTexture || image.height > maximumTexture) {
        const resized = document.createElement('canvas');
        const ratio = maximumTexture / Math.max(image.width, image.height);
        resized.width = Math.floor(image.width * ratio);
        resized.height = Math.floor(image.height * ratio);
        resized.getContext('2d')?.drawImage(image, 0, 0, resized.width, resized.height);
        source = resized;
      }
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, source);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.uniform1i(gl.getUniformLocation(program, `imagery${index}`), index);
      gl.uniform4fv(gl.getUniformLocation(program, `mapping${index}`), satelliteUvMapping(SATELLITE_LAYERS[index].bounds));
    });
    const latitude = MUSEUM_LOCATION.latitude * Math.PI / 180;
    gl.uniform2f(gl.getUniformLocation(program, 'originLatitude'), Math.sin(latitude), Math.cos(latitude));
    gl.uniform1f(gl.getUniformLocation(program, 'originLatitudeRadians'), latitude);
    const altitude = gl.getUniformLocation(program, 'altitude');
    const aspect = gl.getUniformLocation(program, 'aspect');
    const detailOpacity = gl.getUniformLocation(program, 'detailOpacity[0]');
    const opacityValues = new Float32Array(5);
    return {
      draw(progress) {
        if (disposed || gl.isContextLost()) return;
        // Cap raster work on high-density phones: a brief intro must stay light.
        const density = Math.min(window.devicePixelRatio || 1, 1.5);
        const width = Math.max(1, Math.round(canvas.clientWidth * density));
        const height = Math.max(1, Math.round(canvas.clientHeight * density));
        if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
        gl.viewport(0, 0, width, height);
        const ratio = width / height;
        const cameraHeight = flightAltitude(progress, ratio);
        gl.uniform1f(aspect, ratio);
        gl.uniform1f(altitude, cameraHeight);
        for (let index = 0; index < opacityValues.length; index += 1) {
          opacityValues[index] = satelliteLayerOpacity(SATELLITE_LAYERS[index + 1].bounds, cameraHeight, ratio);
        }
        gl.uniform1fv(detailOpacity, opacityValues);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      },
      dispose,
    };
  } catch {
    dispose();
    return null;
  }
}

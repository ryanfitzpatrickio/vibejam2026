import * as THREE from 'three';

// Fullscreen edge detection that replaces per-mesh inverted-hull / EdgesGeometry
// outlines (10-30 draw calls per outlined character) with two passes total:
//   1. Render the scene into an offscreen color + depth target.
//   2. Blit to the backbuffer through a shader that darkens pixels where the
//      linear depth gradient to a neighbor exceeds a threshold proportional to
//      that pixel's depth.
//
// Color pipeline: when Three renders to a WebGLRenderTarget it writes linear
// color without tone mapping or output-colorspace conversion. If we just sample
// that RT and blit it, the result is linear-as-sRGB on the canvas (washed out).
// To preserve the on-screen look, the outline shader reapplies tone mapping and
// sRGB OETF inline. We avoid Three's shader chunks here so the pipeline keeps
// working across engine version bumps.

const VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAG = `
precision highp float;

uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uTexelSize;
uniform float uCameraNear;
uniform float uCameraFar;
uniform float uThickness;
uniform float uThreshold;
uniform float uStrength;
uniform vec3 uOutlineColor;
uniform float uExposure;

varying vec2 vUv;

float linearize(float z) {
  float zn = z * 2.0 - 1.0;
  return (2.0 * uCameraNear * uCameraFar) / (uCameraFar + uCameraNear - zn * (uCameraFar - uCameraNear));
}

// ACES Filmic (narkowicz-ish fit used by Three.js, rescaled by exposure / 0.6
// to match three/examples behavior). Matches renderer.toneMapping =
// ACESFilmicToneMapping.
vec3 acesFilmic(vec3 color) {
  const mat3 ACESInput = mat3(
    0.59719, 0.07600, 0.02840,
    0.35458, 0.90834, 0.13383,
    0.04823, 0.01566, 0.83777
  );
  const mat3 ACESOutput = mat3(
     1.60475, -0.10208, -0.00327,
    -0.53108,  1.10813, -0.07276,
    -0.07367, -0.00605,  1.07602
  );
  color *= uExposure / 0.6;
  color = ACESInput * color;
  vec3 a = color * (color + 0.0245786) - 0.000090537;
  vec3 b = color * (0.983729 * color + 0.4329510) + 0.238081;
  color = a / b;
  color = ACESOutput * color;
  return clamp(color, 0.0, 1.0);
}

// sRGB OETF (linear -> sRGB display encoding). Matches the transfer function
// Three applies when outputColorSpace = SRGBColorSpace.
vec3 sRGBOETF(vec3 c) {
  vec3 hi = pow(c, vec3(1.0 / 2.4)) * 1.055 - vec3(0.055);
  vec3 lo = c * 12.92;
  return mix(hi, lo, vec3(lessThanEqual(c, vec3(0.0031308))));
}

void main() {
  vec4 color = texture2D(tColor, vUv);
  vec2 off = uTexelSize * uThickness;

  float dC = linearize(texture2D(tDepth, vUv).r);
  // Skip pixels on the far plane — outlining the clear/sky just draws a frame
  // around the viewport.
  if (dC < uCameraFar * 0.999) {
    float dU = linearize(texture2D(tDepth, vUv + vec2(0.0, off.y)).r);
    float dD = linearize(texture2D(tDepth, vUv - vec2(0.0, off.y)).r);
    float dL = linearize(texture2D(tDepth, vUv - vec2(off.x, 0.0)).r);
    float dR = linearize(texture2D(tDepth, vUv + vec2(off.x, 0.0)).r);

    float g = max(max(abs(dC - dU), abs(dC - dD)), max(abs(dC - dL), abs(dC - dR)));
    float thr = uThreshold * max(dC, 0.5);
    float edge = smoothstep(thr, thr * 2.0, g) * uStrength;
    color.rgb = mix(color.rgb, uOutlineColor, edge);
  }

  color.rgb = acesFilmic(color.rgb);
  color.rgb = sRGBOETF(max(color.rgb, 0.0));
  gl_FragColor = color;
}
`;

export function createOutlinePipeline({
  renderer,
  color = '#0a0a0a',
  thickness = 1.0,
  threshold = 0.012,
  strength = 0.9,
} = {}) {
  const size = new THREE.Vector2();
  renderer.getSize(size);
  const pixelRatio = renderer.getPixelRatio();

  // With two render passes per frame (scene → RT, quad → canvas), Three's
  // default autoReset would wipe renderer.info between them, and the perf
  // panel would only see the final 1-draw-call quad. Own the reset ourselves
  // so draw-call / triangle counts accumulate across the whole frame.
  renderer.info.autoReset = false;

  const depthTexture = new THREE.DepthTexture();
  depthTexture.type = THREE.UnsignedInt248Type;
  depthTexture.format = THREE.DepthStencilFormat;

  const colorTarget = new THREE.WebGLRenderTarget(
    Math.max(1, Math.floor(size.x * pixelRatio)),
    Math.max(1, Math.floor(size.y * pixelRatio)),
    {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      stencilBuffer: false,
      colorSpace: THREE.LinearSRGBColorSpace,
    },
  );

  const outlineTarget = new THREE.WebGLRenderTarget(
    Math.max(1, Math.floor(size.x * pixelRatio)),
    Math.max(1, Math.floor(size.y * pixelRatio)),
    {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthTexture,
      stencilBuffer: true,
      colorSpace: THREE.LinearSRGBColorSpace,
    },
  );

  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      tColor: { value: colorTarget.texture },
      tDepth: { value: depthTexture },
      uTexelSize: { value: new THREE.Vector2(1 / outlineTarget.width, 1 / outlineTarget.height) },
      uCameraNear: { value: 0.1 },
      uCameraFar: { value: 100 },
      uThickness: { value: thickness },
      uThreshold: { value: threshold },
      uStrength: { value: strength },
      uOutlineColor: { value: new THREE.Color(color) },
      uExposure: { value: renderer.toneMappingExposure ?? 1 },
    },
    depthTest: false,
    depthWrite: false,
    // We do the tone mapping + sRGB OETF ourselves; tell Three not to add any
    // of its own tone-mapping plumbing on top.
    toneMapped: false,
  });

  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const quadScene = new THREE.Scene();
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  quadScene.add(quad);

  let enabled = true;

  function setSize(width, height, nextPixelRatio = renderer.getPixelRatio()) {
    const w = Math.max(1, Math.floor(width * nextPixelRatio));
    const h = Math.max(1, Math.floor(height * nextPixelRatio));
    colorTarget.setSize(w, h);
    outlineTarget.setSize(w, h);
    material.uniforms.uTexelSize.value.set(1 / w, 1 / h);
  }

  function setObjectsVisible(scene, visible) {
    const mutated = [];
    scene.traverse((object) => {
      if (object.userData?.skipFullscreenOutline !== true) return;
      mutated.push([object, object.visible]);
      object.visible = visible;
    });
    return mutated;
  }

  function restoreObjectVisibility(entries) {
    entries.forEach(([object, visible]) => {
      object.visible = visible;
    });
  }

  function render(scene, camera) {
    // Reset once per frame so draw-call / triangle / program counts accumulate
    // across every pass we run below (rather than being wiped between them).
    renderer.info.reset();

    if (!enabled) {
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      return;
    }

    material.uniforms.uCameraNear.value = camera.near;
    material.uniforms.uCameraFar.value = camera.far;
    material.uniforms.uExposure.value = renderer.toneMappingExposure ?? 1;

    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(colorTarget);
    renderer.clear();
    renderer.render(scene, camera);

    const hiddenForOutline = setObjectsVisible(scene, false);
    renderer.setRenderTarget(outlineTarget);
    renderer.clear();
    renderer.render(scene, camera);
    restoreObjectVisibility(hiddenForOutline);

    renderer.setRenderTarget(prevTarget);
    renderer.render(quadScene, quadCamera);
  }

  function setEnabled(value) {
    enabled = !!value;
  }

  function isEnabled() {
    return enabled;
  }

  function setColor(next) {
    material.uniforms.uOutlineColor.value.set(next);
  }

  function setThreshold(next) {
    material.uniforms.uThreshold.value = next;
  }

  function dispose() {
    renderer.info.autoReset = true;
    colorTarget.dispose();
    outlineTarget.dispose();
    depthTexture.dispose?.();
    material.dispose();
    quad.geometry.dispose();
  }

  return {
    render,
    setSize,
    setEnabled,
    isEnabled,
    setColor,
    setThreshold,
    dispose,
  };
}

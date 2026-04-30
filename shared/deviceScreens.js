export const DEVICE_SCREEN_SOURCES = Object.freeze({
  WEB_VIEWPORT: 'web_viewport',
});

export const DEVICE_SCREEN_APPS = Object.freeze({
  DRONE_SHOP: 'drone_shop',
});

export const DRONE_PURCHASE_CHEESE_COST = 12;

export function normalizeDeviceScreenConfig(value = {}) {
  if (value === true) {
    return {
      source: DEVICE_SCREEN_SOURCES.WEB_VIEWPORT,
      app: DEVICE_SCREEN_APPS.DRONE_SHOP,
    };
  }
  const source = value?.source === DEVICE_SCREEN_SOURCES.WEB_VIEWPORT
    ? value.source
    : DEVICE_SCREEN_SOURCES.WEB_VIEWPORT;
  const app = value?.app === DEVICE_SCREEN_APPS.DRONE_SHOP
    ? value.app
    : DEVICE_SCREEN_APPS.DRONE_SHOP;
  return { source, app };
}

export function isDeviceScreenPrimitive(primitive) {
  return primitive?.deleted !== true
    && primitive?.type === 'plane'
    && primitive.deviceScreen != null
    && primitive.deviceScreen !== false;
}

export function collectDeviceScreensFromLayout(layout) {
  const primitives = Array.isArray(layout?.primitives) ? layout.primitives : [];
  return primitives
    .filter(isDeviceScreenPrimitive)
    .map((primitive) => ({
      id: primitive.id,
      name: primitive.name ?? primitive.id,
      position: {
        x: Number(primitive.position?.x) || 0,
        y: Number(primitive.position?.y) || 0,
        z: Number(primitive.position?.z) || 0,
      },
      rotation: {
        x: Number(primitive.rotation?.x) || 0,
        y: Number(primitive.rotation?.y) || 0,
        z: Number(primitive.rotation?.z) || 0,
      },
      scale: {
        x: Math.max(0.05, Number(primitive.scale?.x) || 1),
        y: Math.max(0.05, Number(primitive.scale?.y) || 1),
        z: Math.max(0.05, Number(primitive.scale?.z) || 1),
      },
      config: normalizeDeviceScreenConfig(primitive.deviceScreen),
    }));
}

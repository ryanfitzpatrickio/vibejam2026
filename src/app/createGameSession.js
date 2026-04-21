import * as THREE from 'three';
import { Mouse } from '../entities/Mouse.js';
import { Bunny } from '../entities/Bunny.js';
import { Cat } from '../entities/Cat.js';
import { Human } from '../entities/Human.js';
import { Roomba } from '../entities/Roomba.js';
import { PredatorManager } from '../entities/PredatorManager.js';
import { Room } from '../world/Room.js';
import { RopeSystem } from '../world/RopeSystem.js';
import { VibePortalManager } from '../world/VibePortalManager.js';
import { ThirdPersonCamera } from '../camera/ThirdPersonCamera.js';
import { CharacterController } from '../controllers/CharacterController.js';
import { GamepadManager } from '../input/GamepadManager.js';
import { installInputSourceTracking, getInputSource, actionLabel } from '../input/inputSource.js';
import { HUD } from '../hud/HUD.jsx';
import { RoundRaidOverlay } from '../hud/RoundRaidOverlay.jsx';
import { GameToolbar } from '../hud/GameToolbar.jsx';
import { CatLocatorOverlay } from '../hud/CatLocatorOverlay.jsx';
import { ScoreboardOverlay } from '../hud/ScoreboardOverlay.jsx';
import { ChaseAlertOverlay } from '../hud/ChaseAlertOverlay.jsx';
import { AdversaryStatusOverlay } from '../hud/AdversaryStatusOverlay.jsx';
import { ActionJuiceOverlay } from '../hud/ActionJuiceOverlay.js';
import { WindStreakField } from '../world/WindStreakField.js';
import { attachEdgeOutlines } from '../materials/index.js';
import { createOutlinePipeline } from '../postprocessing/OutlinePipeline.js';
import { NetworkClient } from '../net/NetworkClient.js';
import { RemotePlayerManager } from '../net/RemotePlayerManager.js';
import {
  EmoteManager,
  HUMAN_ADVERSARY_EMOTES,
  HUMAN_ADVERSARY_RAT_EMOTE_ID,
} from '../emote/EmoteManager.js';
import { EmoteWheel } from '../emote/EmoteWheel.jsx';
import { HeroPrompt } from '../hud/HeroPrompt.jsx';
import { TaskController } from '../tasks/TaskController.js';
import { UnlockCollectibles } from '../tasks/UnlockCollectibles.js';
import { HeroAvatar } from '../entities/HeroAvatar.js';
import { getAudioManager } from '../audio/AudioManager.js';
import { OcclusionFader } from '../utils/OcclusionFader.js';
import { createPlayerNameplate, syncNameplateWorldPosition } from '../world/PlayerNameplate.js';
import { isNameplateOccluded } from '../utils/nameplateOcclusion.js';
import {
  getClientPreferredDisplayName,
  setClientPreferredDisplayName,
} from '../utils/playerDisplayName.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { simulateTick, createPlayerState } from '../../shared/physics.js';
import { getRoombaVacuumPullAcceleration } from '../../shared/roomba.js';
import { readVibePortalArrivalFromSearch } from '../../shared/vibePortal.js';
import kitchenNavMesh from '../../shared/kitchen-navmesh.generated.js';
import { playerChaseRecordSeconds } from '../../shared/chaseScore.js';
import { LEVEL_WORLD_BOUNDS_XZ } from '../../shared/levelWorldBounds.js';
import { normalizeRope } from '../../shared/ropes.js';
import { collectSpawnPointsFromLayout } from '../../shared/spawnPoints.js';

function applyAtmosphere(scene) {
  scene.background = new THREE.Color('#8e7a63');
  scene.fog = new THREE.Fog('#8d7964', 16, 68);
}

function createWebGLRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, canvas });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = false;
  // PCFSoftShadowMap is deprecated on WebGLRenderer (Three r183+); PCFShadowMap is the supported path.
  // PCFShadowMap is also more compatible on some mobile Mali GPUs (e.g. G715).
  renderer.shadowMap.type = THREE.PCFShadowMap;
  return renderer;
}

function dampValue(current, target, smoothing, dt) {
  if (dt <= 0) return target;
  const t = 1 - Math.exp(-smoothing * dt);
  return current + (target - current) * t;
}

function shortestAngleDelta(target, current) {
  return THREE.MathUtils.euclideanModulo((target - current) + Math.PI, Math.PI * 2) - Math.PI;
}

function directionBucketFromLateral(current, lateral, enter = 0.34, exit = 0.16) {
  if (current === 'right') return lateral < exit ? 'straight' : 'right';
  if (current === 'left') return lateral > -exit ? 'straight' : 'left';
  if (lateral > enter) return 'right';
  if (lateral < -enter) return 'left';
  return 'straight';
}

const ENABLE_BUNNY_PREDATOR = false;
const ENABLE_CAT_PREDATOR = true;
const ENABLE_ROOMBA_PREDATOR = true;
const ENABLE_HUMAN_PREDATOR = true;
const MOUSE_CAMERA_ARM_LENGTH = 3.5;
const HUMAN_CAMERA_ARM_LENGTH = 8.5;
const MOUSE_CAMERA_SHOULDER_Y = 1.3;
const HUMAN_CAMERA_SHOULDER_Y = 5.6;
const HUMAN_NAMEPLATE_OFFSET_Y = 9.35;
const ACTION_JUICE_MOUSE_OFFSET_Y = 1.14;
const ACTION_JUICE_HUMAN_OFFSET_Y = 5.6;
const MISCHIEF_CHAIN_WINDOW_SECONDS = 3.4;
const ROPE_HINT_RANGE = 1.85;
const ROPE_POSE_GRACE_SECONDS = 0.22;
const GRAB_ONE_SHOT_ANIM_SECONDS = 0.6;

function pickRemoteRoombaSnapshot(remotePredators) {
  for (const p of remotePredators.values()) {
    if (p?.type === 'roomba') return p;
  }
  return null;
}

/** Matches server vacuum pull for client prediction (snapshot uses `ai` not `phase`). */
function vacuumPullForPrediction(net, predictionState) {
  if (!net?.connected) return null;
  const snap = pickRemoteRoombaSnapshot(net.remotePredators);
  if (!snap || snap.alive === false || snap.ai !== 'vacuuming') return null;
  return getRoombaVacuumPullAcceleration(
    {
      position: { x: snap.px, y: snap.py ?? 0, z: snap.pz },
      phase: snap.ai,
      alive: true,
    },
    predictionState,
  );
}

const AUDIO_PREFS_KEY = 'mouse-trouble-audio-prefs';
const GITHUB_URL = 'https://github.com/ryanfitzpatrickio/vibejam2026';

/** Cat AI states where the hunt target is the local player — drives ambient crossfade. */
const CAT_AMBIENT_HUNT_AI = new Set(['alert', 'roar', 'chase', 'attack', 'cooldown']);

function readAudioPrefs() {
  try {
    const raw = window.localStorage?.getItem(AUDIO_PREFS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return {
      musicMuted: !!parsed?.musicMuted,
      sfxMuted: !!parsed?.sfxMuted,
    };
  } catch {
    return { musicMuted: false, sfxMuted: false };
  }
}

function writeAudioPrefs(prefs) {
  try {
    window.localStorage?.setItem(AUDIO_PREFS_KEY, JSON.stringify({
      musicMuted: !!prefs.musicMuted,
      sfxMuted: !!prefs.sfxMuted,
    }));
  } catch {
    // Local storage may be unavailable in private contexts.
  }
}

function buildNavMeshOverlay(navMesh) {
  const group = new THREE.Group();
  group.name = 'navmesh-overlay';

  const fillPositions = [];
  const linePositions = [];

  for (const tile of Object.values(navMesh?.tiles ?? {})) {
    const vertices = tile?.vertices;
    const polys = tile?.polys;
    if (!Array.isArray(vertices) || !Array.isArray(polys)) continue;

    for (const poly of polys) {
      const indices = Array.isArray(poly?.vertices)
        ? poly.vertices.filter((index) => Number.isInteger(index) && index >= 0)
        : [];
      if (indices.length < 3) continue;

      const points = indices.map((index) => {
        const base = index * 3;
        return {
          x: vertices[base],
          y: (vertices[base + 1] ?? 0) + 0.03,
          z: vertices[base + 2],
        };
      });

      for (let i = 1; i < points.length - 1; i += 1) {
        const a = points[0];
        const b = points[i];
        const c = points[i + 1];
        fillPositions.push(
          a.x, a.y, a.z,
          b.x, b.y, b.z,
          c.x, c.y, c.z,
        );
      }

      for (let i = 0; i < points.length; i += 1) {
        const current = points[i];
        const next = points[(i + 1) % points.length];
        linePositions.push(
          current.x, current.y + 0.005, current.z,
          next.x, next.y + 0.005, next.z,
        );
      }
    }
  }

  if (fillPositions.length) {
    const fillGeometry = new THREE.BufferGeometry();
    fillGeometry.setAttribute('position', new THREE.Float32BufferAttribute(fillPositions, 3));
    const fillMaterial = new THREE.MeshBasicMaterial({
      color: '#6de2b5',
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const fillMesh = new THREE.Mesh(fillGeometry, fillMaterial);
    fillMesh.renderOrder = 50;
    group.add(fillMesh);
  }

  if (linePositions.length) {
    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
    const lineMaterial = new THREE.LineBasicMaterial({
      color: '#b7fff0',
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    const lineSegments = new THREE.LineSegments(lineGeometry, lineMaterial);
    lineSegments.renderOrder = 51;
    group.add(lineSegments);
  }

  group.visible = false;
  return group;
}

function createOfflineNetClient(roomId = 'offline') {
  return {
    ws: null,
    roomId,
    localId: 'offline-local',
    connected: false,
    remotePlayers: new Map(),
    remotePredators: new Map(),
    pushBalls: [],
    ropes: [],
    cheesePickups: [],
    round: null,
    extractionPortals: [],
    adversary: { playerId: null, available: false, safeRadius: 0 },
    serverState: null,
    serverSeq: -1,
    ping: 0,
    heroClaims: {},
    unlockItems: [],
    _listeners: new Set(),
    connect() {},
    disconnect() {},
    on(fn) {
      this._listeners.add(fn);
      return () => this._listeners.delete(fn);
    },
    sendInput() { return 0; },
    sendSpawnExtraBall() {},
    sendTaskComplete() {},
    sendUnlockPickup() {},
    sendClaimHero() {},
    sendDisplayName() {},
    async fetchLeaderboard() { return null; },
  };
}

export async function createGameSession({
  canvas,
  roomId = 'default',
  roomVisibility = 'public',
  onCopyInvite = null,
  onCreatePrivateRoom = null,
  offlineMode = false,
} = {}) {
  const scene = new THREE.Scene();
  applyAtmosphere(scene);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);

  const mouse = new Mouse({
    furColor: '#f5a962',
    bellyColor: '#f8d4b0',
  });
  scene.add(mouse);

  const renderer = createWebGLRenderer(canvas);
  canvas.style.position = 'relative';
  canvas.style.zIndex = '0';

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.style.position = 'fixed';
  labelRenderer.domElement.style.inset = '0';
  labelRenderer.domElement.style.pointerEvents = 'none';
  /** Above WebGL canvas and typical embeds — labels are not depth-tested against the world. */
  labelRenderer.domElement.style.zIndex = '10000';
  document.body.appendChild(labelRenderer.domElement);

  const navMeshOverlay = buildNavMeshOverlay(kitchenNavMesh);
  scene.add(navMeshOverlay);

  const room = new Room({ height: 4, scale: 1 });
  scene.add(room.getGroup());
  // The Mouse builds its primitive avatar synchronously in its constructor and
  // streams the skinned GLB in behind the scenes. The Room synchronously
  // builds its procedural geometry in the constructor and streams the texture
  // atlas / editable layout / GLB prefabs in via `room.ready`. This lets us
  // render frame 1 immediately instead of blocking the boot on network I/O.
  mouse.position.set(0, mouse.groundOffset, 0);
  mouse.setViewCamera(camera);
  // Re-seat the mouse once the skinned model is in place — the avatar swap
  // changes `groundOffset`, so we keep the first frame visually stable and
  // update once the GLB lands.
  mouse.ready.then(() => {
    mouse.position.y = mouse.groundOffset;
  }).catch(() => {});
  // Static merge depends on the editable layout being materialized, which
  // only happens once `room.ready` resolves (atlas + layout JSON + prefabs).
  // Defer the bake until then so we don't miss any prefab geometry.
  room.ready.then(() => {
    room.setStaticMergeEnabled?.(true);
  }).catch(() => {});
  const devLayoutSyncToken = import.meta.env.DEV ? (import.meta.env.VITE_DEV_LAYOUT_SYNC_TOKEN ?? '') : '';
  let devLayoutReady = false;
  let devLayoutSyncedForConnection = false;
  const maybeSyncDevLayoutToServer = () => {
    if (offlineMode || !devLayoutSyncToken || !devLayoutReady || devLayoutSyncedForConnection || !net.connected) {
      return;
    }
    const layout = room.getEditableLayout?.();
    if (!layout?.primitives) return;
    if (net.sendDevSyncLayout?.(layout, devLayoutSyncToken)) {
      devLayoutSyncedForConnection = true;
    }
  };
  room.ready.then(() => {
    devLayoutReady = true;
    maybeSyncDevLayoutToServer();
  }).catch(() => {});

  let roomba = null;
  function getCollisionCollidersWithRoomba() {
    const list = room.getCollisionColliders();
    if (ENABLE_ROOMBA_PREDATOR && roomba?.visible) {
      const rb = roomba.getPhysicsCollider();
      if (rb) list.push(rb);
    }
    return list;
  }
  const localMouseOutlineMeshes = attachEdgeOutlines(mouse, {
    color: '#090909',
    thresholdAngle: 24,
    opacity: 0.95,
    batch: false,
  });
  const roomOutlineMeshes = attachEdgeOutlines(room.getGroup(), {
    color: '#090909',
    thresholdAngle: 22,
    opacity: 0.9,
  });
  // Default: the fullscreen depth-edge pass replaces the per-mesh outlines on
  // mice AND the batched room outlines. The per-mesh toggles stay available
  // so you can A/B-compare at runtime.
  setOutlineListVisible(localMouseOutlineMeshes, false);
  setOutlineListVisible(roomOutlineMeshes, false);
  const outlinePipeline = createOutlinePipeline({
    renderer,
    color: '#0a0a0a',
    thickness: 1.0,
    threshold: 0.012,
    strength: 0.9,
  });

  function setOutlineListVisible(list, visible) {
    if (!Array.isArray(list)) return;
    const v = !!visible;
    for (const obj of list) {
      if (obj) obj.visible = v;
    }
  }
  const render = () => {
    outlinePipeline.render(scene, camera);
    if (perfFlags.labels) {
      labelRenderer.render(scene, camera);
    }
  };

  const perfFlags = {
    labels: true,
    gameplayUi: true,
    localPlayer: true,
    remotePlayers: true,
    predators: true,
    wind: true,
    ropes: true,
    raidMarkers: true,
  };

  const thirdPersonCamera = new ThirdPersonCamera({
    camera,
    domElement: canvas,
    armLength: MOUSE_CAMERA_ARM_LENGTH,
    maxArmLength: 11,
    collisionQuery: getCollisionCollidersWithRoomba,
  });

  const controller = new CharacterController({
    mouse,
    thirdPersonCamera,
    collisionQuery: getCollisionCollidersWithRoomba,
  });

  let mobileControls = null;

  installInputSourceTracking();

  controller.onEmote = () => {
    emoteWheel.show();
  };
  controller.onEmoteEnd = () => {
    emoteWheel.confirm();
  };

  // --- Predators ---
  const bunny = ENABLE_BUNNY_PREDATOR ? new Bunny() : null;
  const human = ENABLE_HUMAN_PREDATOR ? new Human() : null;
  const predatorManager = (ENABLE_BUNNY_PREDATOR || ENABLE_HUMAN_PREDATOR)
    ? new PredatorManager({
      scene,
      controller,
      collisionQuery: getCollisionCollidersWithRoomba,
    })
    : null;

  if (bunny && predatorManager) {
    bunny.ready.then(() => {
      predatorManager.add(bunny, new THREE.Vector3(5, 0, 5));
    }).catch(() => {});
  }

  if (human && predatorManager) {
    Promise.all([human.ready, room.ready]).then(() => {
      const spawn = collectSpawnPointsFromLayout(room.getEditableLayout()).human?.[0];
      predatorManager.add(human, new THREE.Vector3(
        spawn?.x ?? -4,
        spawn?.y ?? 0,
        spawn?.z ?? 4,
      ));
    }).catch(() => {});
  }

  const cat = ENABLE_CAT_PREDATOR ? new Cat() : null;
  if (cat) {
    cat.ready.then(() => {
      cat.position.set(3, 0, -3);
      scene.add(cat);
    }).catch(() => {});
  }

  roomba = ENABLE_ROOMBA_PREDATOR ? new Roomba() : null;
  if (roomba) {
    const roombaInstance = roomba;
    roombaInstance.ready.then(() => {
      roombaInstance.visible = false;
      roombaInstance.dockGroup.visible = false;
      scene.add(roombaInstance);
      scene.add(roombaInstance.dockGroup);
    }).catch(() => {});
  }

  // --- Dev placement mode ---
  let placementMode = null;
  if (import.meta.env.DEV) {
    const { PlacementMode } = await import('../dev/PlacementMode.js');
    placementMode = new PlacementMode({ domElement: canvas });

    const placeables = [];
    if (cat?.eyeAnimator?.group) {
      placeables.push({ label: 'CatEyes', target: cat.eyeAnimator.group, owner: cat.eyeAnimator });
    }

    let placementIndex = -1;
    window.startPlacement = (target, opts) => {
      if (target) {
        placementMode.activate(target, opts);
      } else {
        placementIndex = (placementIndex + 1) % (placeables.length || 1);
        const p = placeables[placementIndex];
        if (p) {
          placementMode.activate(p.target, {
            label: p.label,
            onDone: (placement) => {
              if (p.owner?.setPlacement) {
                p.owner.setPlacement(placement);
              }
            },
          });
        }
      }
    };

    if (cat) window.cat = cat;
    window.mouse = mouse;
  }

  const hud = new HUD();
  const roundRaid = new RoundRaidOverlay();
  const catLocator = new CatLocatorOverlay();
  const actionJuice = new ActionJuiceOverlay({ scene });

  const isCoarsePointer = typeof window !== 'undefined'
    && window.matchMedia?.('(pointer: coarse)').matches;
  const SMACK_BALL_HINT_COOLDOWN_MS = 2200;
  let smackBallHintCooldownUntil = 0;
  let activeHintId = null;
  let _smackFiredThisFrame = false;
  let _wasHero = false;
  let _prevRoundPhase = null;

  const extractionMarkerGroup = new THREE.Group();
  extractionMarkerGroup.name = 'ExtractionPortals';
  scene.add(extractionMarkerGroup);
  const _portalRingGeo = new THREE.RingGeometry(0.55, 0.88, 28);
  const _portalRingMat = new THREE.MeshBasicMaterial({
    color: '#facc15',
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.88,
    depthWrite: false,
  });

  const audioManager = getAudioManager();
  audioManager.attachListenerToCamera(camera);
  if (roomba) audioManager.attachRoombaAudio(roomba);
  const audioPrefs = readAudioPrefs();
  audioManager.setMusicMuted(audioPrefs.musicMuted);
  audioManager.setSFXMuted(audioPrefs.sfxMuted);
  let ambientPrimed = false;
  function primeAmbientAudio(event) {
    if (event) {
      const t = event.target;
      if (
        t instanceof HTMLElement
        && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))
      ) {
        return;
      }
    }
    if (ambientPrimed) return;
    ambientPrimed = true;
    void (async () => {
      await audioManager.resume();
      audioManager.prefetchMovementLoopBuffer();
      audioManager.prefetchJumpSfx();
      audioManager.prefetchEmoteBuffers();
      audioManager.prefetchInteractionSfx();
      await audioManager.startAmbientBed();
    })();
  }
  canvas.addEventListener('pointerdown', primeAmbientAudio, { passive: true });
  window.addEventListener('keydown', primeAmbientAudio, { passive: true });
  window.addEventListener('touchstart', primeAmbientAudio, { passive: true });

  function setMusicMuted(muted) {
    audioPrefs.musicMuted = !!muted;
    audioManager.setMusicMuted(audioPrefs.musicMuted);
    writeAudioPrefs(audioPrefs);
    toolbar.updateState(audioPrefs);
  }

  function setSfxMuted(muted) {
    audioPrefs.sfxMuted = !!muted;
    audioManager.setSFXMuted(audioPrefs.sfxMuted);
    writeAudioPrefs(audioPrefs);
    toolbar.updateState(audioPrefs);
  }

  let leaderboardRequestSeq = 0;
  const toolbar = new GameToolbar({
    githubUrl: GITHUB_URL,
    displayName: getClientPreferredDisplayName(),
    roomId,
    roomVisibility,
    onToggleMusic: () => {
      primeAmbientAudio();
      setMusicMuted(!audioPrefs.musicMuted);
    },
    onToggleSfx: () => {
      void audioManager.resume();
      setSfxMuted(!audioPrefs.sfxMuted);
    },
    onOpenGithub: () => {
      window.open(GITHUB_URL, '_blank', 'noopener,noreferrer');
    },
    onOpenLeaderboard: async () => {
      const requestSeq = ++leaderboardRequestSeq;
      toolbar.setAllTimeLeaderboards(toolbar.allTimeLeaderboards, 'Loading all-time scores...');
      const data = await net.fetchLeaderboard();
      if (requestSeq !== leaderboardRequestSeq) return;
      toolbar.setAllTimeLeaderboards(data, data ? '' : 'All-time scores unavailable');
    },
    onChangeDisplayName: (rawName) => {
      const displayName = setClientPreferredDisplayName(rawName);
      predictionState.displayName = displayName;
      if (net.serverState) net.serverState.displayName = displayName;
      net.sendDisplayName(displayName);
      return displayName;
    },
    onCopyInvite,
    onCreatePrivateRoom,
  });
  toolbar.updateState({
    ...audioPrefs,
    displayName: getClientPreferredDisplayName(),
    roomId,
    roomVisibility,
  });

  const emoteManager = new EmoteManager({
    mouse,
    audioManager,
    scene,
    getTargetObject: () => (predictionState?.isAdversary && human?.playerControlled ? human : mouse),
    getBubbleOffsetY: () => (predictionState?.isAdversary ? HUMAN_NAMEPLATE_OFFSET_Y : undefined),
    isHumanEmoter: () => !!(predictionState?.isAdversary && human?.playerControlled),
    onSpecialEmote: (def) => {
      if (def.id !== HUMAN_ADVERSARY_RAT_EMOTE_ID) return;
      if (!predictionState?.isAdversary || !human?.playerControlled) return;
      human.playPlayableMemeEmote?.();
    },
    onSpecialEmoteCancel: (def) => {
      if (def.id === HUMAN_ADVERSARY_RAT_EMOTE_ID) {
        human?.cancelPlayableMemeEmote?.();
      }
    },
  });
  const heroPrompt = new HeroPrompt();
  let localHeroBrain = null;
  let localHeroModelKey = null;
  function ensureLocalHeroBrain(active, modelKey) {
    // Re-spawn if the server picked a different hero model than what we
    // currently render (e.g. respawn picked a new random hero).
    if (active && localHeroBrain && modelKey && modelKey !== localHeroModelKey) {
      mouse.remove(localHeroBrain);
      localHeroBrain.dispose();
      localHeroBrain = null;
    }
    if (active && !localHeroBrain) {
      localHeroModelKey = modelKey || 'brain';
      localHeroBrain = new HeroAvatar(localHeroModelKey);
      mouse.add(localHeroBrain);
      if (mouse.bodyPivot) mouse.bodyPivot.visible = false;
    } else if (!active && localHeroBrain) {
      mouse.remove(localHeroBrain);
      localHeroBrain.dispose();
      localHeroBrain = null;
      localHeroModelKey = null;
      if (mouse.bodyPivot) mouse.bodyPivot.visible = true;
    }
  }
  const emoteWheel = new EmoteWheel({
    getEmotes: () => (predictionState?.isAdversary ? HUMAN_ADVERSARY_EMOTES : undefined),
    onSelect: (emoteId) => {
      emoteManager.play(emoteId);
    },
  });

  const taskPromptElement = document.createElement('div');
  taskPromptElement.id = 'task-interact-prompt';
  Object.assign(taskPromptElement.style, {
    position: 'fixed',
    left: '50%',
    bottom: '24%',
    transform: 'translateX(-50%)',
    padding: '10px 18px',
    'border-radius': '14px',
    background: 'linear-gradient(180deg, rgba(126,136,152,0.92) 0%, rgba(84,93,108,0.92) 100%)',
    border: '2px solid rgba(180, 190, 210, 0.9)',
    'box-shadow': 'inset 0 2px 0 rgba(255,255,255,0.25), 0 6px 14px rgba(0,0,0,0.45)',
    color: '#ffe08a',
    font: '700 16px "Fredoka", "Baloo", system-ui, sans-serif',
    'letter-spacing': '0.04em',
    'text-shadow': '-1.5px -1.5px 0 #0b1220, 1.5px -1.5px 0 #0b1220, -1.5px 1.5px 0 #0b1220, 1.5px 1.5px 0 #0b1220',
    'z-index': '180',
    'pointer-events': 'none',
    display: 'none',
  });
  document.body.appendChild(taskPromptElement);

  const taskController = new TaskController({
    scene,
    room,
    controller,
    getPlayer: () => (predictionState?.isAdversary && human?.playerControlled ? human : mouse),
    promptElement: taskPromptElement,
    setControlsEnabled: (enabled) => controller.setInputEnabled(enabled),
  });
  controller.onInteract = () => {
    taskController.tryInteract();
  };
  // Task markers (poles with diamonds) stay visible in gameplay so players
  // can spot interactable task points.
  room.setRaidTaskHelpersVisible(true);
  room.ready?.then?.(() => room.setRaidTaskHelpersVisible(true)).catch(() => {});

  const occlusionFader = new OcclusionFader({
    scene,
    camera,
    getPlayer: () => (predictionState?.isAdversary && human?.playerControlled ? human : mouse),
  });

  // --- Multiplayer ---
  const portalArrival = readVibePortalArrivalFromSearch(window.location.search);
  const net = offlineMode
    ? createOfflineNetClient(roomId)
    : new NetworkClient(roomId, {
      portalArrival: portalArrival.active ? portalArrival : null,
    });
  taskController.net = net;
  const unlockCollectibles = new UnlockCollectibles({
    scene,
    net,
    getPlayer: () => (predictionState?.isAdversary && human?.playerControlled ? human : mouse),
  });
  // Expose collection counters to the hero-unlock dialog (reads current
  // server-authoritative counts for the local player).
  window.__unlockCollected = (heroKey) => {
    const ss = net.serverState;
    if (!ss) return 0;
    if (heroKey === 'gus') return ss.sewingCollected ?? 0;
    if (heroKey === 'speedy') return ss.speedTokensCollected ?? 0;
    return 0;
  };

  // Visuals for the unlock markers: default helper (pole + diamond) vs. a
  // pile after the hero is claimed. Rebuilt on round reset.
  function clearGroupChildren(g) {
    while (g.children.length) {
      const c = g.children[0];
      g.remove(c);
      c.traverse?.((n) => {
        if (n.geometry) n.geometry.dispose?.();
        if (n.material) {
          const mats = Array.isArray(n.material) ? n.material : [n.material];
          for (const m of mats) m.dispose?.();
        }
      });
    }
  }

  function buildDefaultMarkerVisuals(group, id) {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 1.1, 12),
      new THREE.MeshBasicMaterial({ color: '#e8b84a', transparent: true, opacity: 0.92, depthWrite: false, toneMapped: false }),
    );
    pole.position.y = 0.55;
    pole.userData.raidTaskId = id;
    pole.userData.skipOutline = true;
    group.add(pole);
    const top = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.26, 0),
      new THREE.MeshBasicMaterial({ color: '#ffd27a', transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false }),
    );
    top.position.y = 1.22;
    top.userData.raidTaskId = id;
    top.userData.skipOutline = true;
    group.add(top);
  }

  function buildPileVisuals(group, heroKey) {
    const color = heroKey === 'gus' ? 0xd486a8 : 0x6fb4ff;
    for (let i = 0; i < 5; i += 1) {
      const s = 0.13 + Math.random() * 0.08;
      const mesh = new THREE.Mesh(
        new THREE.IcosahedronGeometry(s, 0),
        new THREE.MeshStandardMaterial({ color, roughness: 0.6 }),
      );
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.25;
      mesh.position.set(Math.cos(a) * r, s, Math.sin(a) * r);
      group.add(mesh);
    }
  }

  function forEachUnlockMarker(fn) {
    const entries = room?.editableRaidTaskObjects;
    if (!entries) return;
    for (const entry of entries.values()) {
      const t = entry?.definition?.taskType;
      if (t === 'unlock_gus' || t === 'unlock_speedy') fn(entry);
    }
  }

  net.on((data) => {
    if (data?.type === 'open') {
      devLayoutSyncedForConnection = false;
      maybeSyncDevLayoutToServer();
      return;
    }
    if (data?.type === 'hero-claimed') {
      const expectedType = data.heroKey === 'gus' ? 'unlock_gus' : 'unlock_speedy';
      forEachUnlockMarker((entry) => {
        if (entry.definition.taskType !== expectedType) return;
        clearGroupChildren(entry.group);
        buildPileVisuals(entry.group, data.heroKey);
      });
      return;
    }
    if (data?.type === 'unlock-reset') {
      forEachUnlockMarker((entry) => {
        clearGroupChildren(entry.group);
        buildDefaultMarkerVisuals(entry.group, entry.definition.id);
      });
    }
  });
  const remotePlayerManager = new RemotePlayerManager({ scene });
  // Per-mesh outlines on remote mice are redundant once the fullscreen outline
  // pass is active; leave the toggle available for comparison.
  remotePlayerManager.setEdgeOutlinesVisible(false);
  if (!offlineMode) net.connect();

  /** Track previous smackStunTimer / grabbedTarget per player for audio event detection. */
  const _prevSmackStun = new Map();
  const _prevGrabbedTarget = new Map();
  let _prevCatAiState = 'idle';

  const _localNameplateWorld = new THREE.Vector3();
  const _physicsInputDir = new THREE.Vector3();
  const _physicsForward = new THREE.Vector3();
  const _physicsRight = new THREE.Vector3();
  const _physicsWorldUp = new THREE.Vector3(0, 1, 0);
  const _physicsJumpSoundPos = new THREE.Vector3();
  const _spatialEventPos = new THREE.Vector3();
  const _actionJuiceWorldPos = new THREE.Vector3();
  /** Per-player snapshot state used for popup deltas. */
  const _prevActionJuiceState = new Map();
  /** Per-player smack combo window. */
  const _mischiefChains = new Map();
  let occlusionFrameIndex = 0;

  const DEFAULT_PUSH_BALL_RADIUS = 0.38;
  const PUSH_BALL_MAX_INSTANCES = 128;
  const pushBallUnitGeometry = new THREE.SphereGeometry(1, 20, 14);
  const pushBallSharedMaterial = new THREE.MeshStandardMaterial({ metalness: 0.16, roughness: 0.52 });
  const pushBallInstanced = new THREE.InstancedMesh(
    pushBallUnitGeometry,
    pushBallSharedMaterial,
    PUSH_BALL_MAX_INSTANCES,
  );
  pushBallInstanced.name = 'PushBallsInstanced';
  pushBallInstanced.castShadow = true;
  pushBallInstanced.receiveShadow = true;
  pushBallInstanced.count = 0;
  pushBallInstanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  pushBallInstanced.frustumCulled = false;
  scene.add(pushBallInstanced);

  const ropeSystem = new RopeSystem({
    resolveTexture: (atlasId, cellIndex) => room._createAtlasTexture(cellIndex, atlasId),
  });
  scene.add(ropeSystem);

  /** @type {Map<string, { smoothPos: THREE.Vector3, smoothQuat: THREE.Quaternion, targetPos: THREE.Vector3, targetQuat: THREE.Quaternion, radius: number }>} */
  const pushBallStates = new Map();
  const _pushBallMatrix = new THREE.Matrix4();
  const _pushBallScale = new THREE.Vector3();
  const _pushBallColor = new THREE.Color();
  let pushBallsRenderVisible = true;

  const CHEESE_PICKUP_MAX_INSTANCES = 256;
  const cheesePickupGroup = new THREE.Group();
  cheesePickupGroup.name = 'WorldCheesePickups';
  scene.add(cheesePickupGroup);
  const cheesePickupGeometry = new THREE.ConeGeometry(0.24, 0.38, 6);
  cheesePickupGeometry.rotateX(Math.PI);
  const cheesePickupMaterial = new THREE.MeshStandardMaterial({
    color: '#f2d046',
    emissive: '#806018',
    emissiveIntensity: 0.22,
    roughness: 0.42,
    metalness: 0.06,
  });
  const cheesePickupInstanced = new THREE.InstancedMesh(
    cheesePickupGeometry,
    cheesePickupMaterial,
    CHEESE_PICKUP_MAX_INSTANCES,
  );
  cheesePickupInstanced.name = 'CheesePickupsInstanced';
  cheesePickupInstanced.castShadow = true;
  cheesePickupInstanced.receiveShadow = true;
  cheesePickupInstanced.count = 0;
  cheesePickupInstanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  cheesePickupInstanced.frustumCulled = false;
  cheesePickupInstanced.visible = false;
  cheesePickupGroup.add(cheesePickupInstanced);
  /** @type {Map<string, { phase: number, spinY: number }>} */
  const cheesePickupStates = new Map();
  const _cheeseMatrix = new THREE.Matrix4();
  const _cheesePos = new THREE.Vector3();
  const _cheeseQuat = new THREE.Quaternion();
  const _cheeseEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  const _cheeseScale = new THREE.Vector3();

  function cheesePickupVisualScale(amount) {
    const n = Math.max(1, Math.floor(Number(amount) || 1));
    return Math.min(2.5, 0.58 + 0.022 * Math.min(n, 200));
  }

  function resize(width, height, pixelRatio = window.devicePixelRatio || 1) {
    const safeWidth = Math.max(1, Math.floor(width));
    const safeHeight = Math.max(1, Math.floor(height));
    const clampedPixelRatio = Math.min(2, pixelRatio);
    renderer.setPixelRatio(clampedPixelRatio);
    renderer.setSize(safeWidth, safeHeight, false);
    labelRenderer.setSize(safeWidth, safeHeight);
    outlinePipeline.setSize(safeWidth, safeHeight, clampedPixelRatio);
    camera.aspect = safeWidth / safeHeight;
    camera.updateProjectionMatrix();
  }

  // --- Client-side prediction using shared physics ---
  // Uses simulateTick (same code as server) so prediction matches server exactly,
  // eliminating rubberbanding from divergent physics.
  const CLIENT_BOUNDS = LEVEL_WORLD_BOUNDS_XZ;
  const predictionState = createPlayerState('local');
  predictionState.displayName = getClientPreferredDisplayName();
  const localNameplateAnchor = new THREE.Object3D();
  localNameplateAnchor.name = 'LocalNameplateAnchor';
  scene.add(localNameplateAnchor);
  const localNameplate = createPlayerNameplate(localNameplateAnchor, predictionState.displayName);
  function setLabelsEnabled(enabled) {
    perfFlags.labels = !!enabled;
    labelRenderer.domElement.style.display = perfFlags.labels ? '' : 'none';
    localNameplate.setVisible(perfFlags.labels);
    remotePlayerManager.setNameplatesVisible(perfFlags.labels);
    actionJuice.setEnabled(perfFlags.labels && perfFlags.gameplayUi);
  }

  function setGameplayUiEnabled(enabled) {
    perfFlags.gameplayUi = !!enabled;
    hud.setVisible(perfFlags.gameplayUi);
    roundRaid.setVisible(perfFlags.gameplayUi);
    catLocator.setVisible(perfFlags.gameplayUi);
    scoreboard.setVisible(perfFlags.gameplayUi);
    toolbar.setVisible(perfFlags.gameplayUi);
    chaseAlert.setVisible(perfFlags.gameplayUi);
    adversaryStatus.setVisible(perfFlags.gameplayUi);
    heroPrompt.setEnabled(perfFlags.gameplayUi);
    actionJuice.setEnabled(perfFlags.labels && perfFlags.gameplayUi);
    taskPromptElement.style.display = 'none';
  }

  function setLocalPlayerVisible(enabled) {
    perfFlags.localPlayer = !!enabled;
    mouse.visible = perfFlags.localPlayer && !(predictionState.isAdversary && human?.playerControlled);
  }

  function setRemotePlayersVisible(enabled) {
    perfFlags.remotePlayers = !!enabled;
    remotePlayerManager.setPlayersVisible(perfFlags.remotePlayers);
  }

  function setPredatorsVisible(enabled) {
    perfFlags.predators = !!enabled;
    if (!perfFlags.predators) {
      if (cat) cat.visible = false;
      if (roomba) {
        roomba.visible = false;
        roomba.dockGroup.visible = false;
      }
      if (human) human.visible = false;
    }
  }

  function setWindVisible(enabled) {
    perfFlags.wind = !!enabled;
    if (!perfFlags.wind) {
      windStreaks.setIntensity(0);
      windStreaks.update(0);
    }
  }

  function setRopesVisible(enabled) {
    perfFlags.ropes = !!enabled;
    ropeSystem.visible = perfFlags.ropes;
  }

  function setRaidMarkersVisible(enabled) {
    perfFlags.raidMarkers = !!enabled;
    room.setRaidTaskHelpersVisible(perfFlags.raidMarkers);
    extractionMarkerGroup.visible = perfFlags.raidMarkers && extractionMarkerGroup.children.length > 0;
  }
  let lastReconciledSeq = -2;
  const vibePortalManager = new VibePortalManager({
    scene,
    getPlayerState: () => predictionState,
    getPlayerObject: () => mouse,
    getPlayerColor: () => '#f5a962',
    getPortalPlacements: () => room.getVibePortalPlacements(),
  });

  const scoreboard = new ScoreboardOverlay();
  const gamepadManager = new GamepadManager({
    controller,
    thirdPersonCamera,
    scoreboardOverlay: scoreboard,
    onToggleControlSides: () => {
      mobileControls?.toggleSides?.();
    },
    onSpawnExtraBall: () => {
      spawnExtraBall();
    },
  });
  const chaseAlert = new ChaseAlertOverlay();
  const adversaryStatus = new AdversaryStatusOverlay({
    onToggle: () => { controller.adversaryTogglePressed = true; },
  });
  const windStreaks = new WindStreakField({ camera });
  // The camera must be in the scene for its children (the wind streak LineSegments)
  // to render. Three.js skips children of objects not attached to the active scene.
  if (!camera.parent) scene.add(camera);

  function isLocalPlayerCatHuntTarget() {
    const lid = net.localId;
    if (!lid || !net.connected) return false;
    for (const p of net.remotePredators.values()) {
      if (p?.alive === false) continue;
      if (p?.type && p.type !== 'cat') continue;
      if (p?.chaseTargetId !== lid) continue;
      const ai = p?.ai;
      if (typeof ai === 'string' && CAT_AMBIENT_HUNT_AI.has(ai)) return true;
    }
    return false;
  }

  function scoreboardLabel(id, localId) {
    if (id === localId) return 'You';
    if (typeof id === 'string' && id.startsWith('bot-')) return `Bot ${id.slice(4)}`;
    if (typeof id === 'string' && id.length > 12) return id.slice(0, 8);
    return String(id);
  }

  function scoreboardRowLabel(id, localId, p) {
    const dn = typeof p?.displayName === 'string' && p.displayName.trim() ? p.displayName.trim() : '';
    if (dn) return id === localId ? `${dn} (you)` : dn;
    return scoreboardLabel(id, localId);
  }

  function playerActionJuiceOffsetY(playerState) {
    return playerState?.isAdversary ? ACTION_JUICE_HUMAN_OFFSET_Y : ACTION_JUICE_MOUSE_OFFSET_Y;
  }

  function copyPlayerActionJuiceState(playerState) {
    return {
      cheeseCarried: Math.max(0, Math.floor(Number(playerState?.cheeseCarried) || 0)),
      smacksLanded: Math.max(0, Math.floor(Number(playerState?.roundStats?.smacksLanded) || 0)),
      smackStunTimer: Math.max(0, Number(playerState?.smackStunTimer) || 0),
    };
  }

  function spawnActionJuice(playerState, text, tone) {
    if (!playerState?.position || !text) return;
    _actionJuiceWorldPos.set(
      Number(playerState.position.x) || 0,
      Number(playerState.position.y) || 0,
      Number(playerState.position.z) || 0,
    );
    actionJuice.spawn({
      text,
      tone,
      position: _actionJuiceWorldPos,
      yOffset: playerActionJuiceOffsetY(playerState),
    });
  }

  function syncActionJuicePopups(allPlayers, nowSeconds) {
    const seen = new Set();
    for (const [playerId, playerState] of allPlayers) {
      if (!playerState) continue;
      seen.add(playerId);
      const next = copyPlayerActionJuiceState(playerState);
      const prev = _prevActionJuiceState.get(playerId);
      if (prev) {
        const cheeseGain = next.cheeseCarried - prev.cheeseCarried;
        if (cheeseGain > 0 && playerState.alive !== false && !playerState.isAdversary) {
          spawnActionJuice(playerState, `+${cheeseGain} 🧀`, 'cheese');
        }

        const mischiefGain = next.smacksLanded - prev.smacksLanded;
        if (mischiefGain > 0 && playerState.alive !== false) {
          const chain = _mischiefChains.get(playerId) ?? { combo: 0, lastAt: -Infinity };
          chain.combo = (nowSeconds - chain.lastAt) <= MISCHIEF_CHAIN_WINDOW_SECONDS ? chain.combo : 0;
          chain.combo += mischiefGain;
          chain.lastAt = nowSeconds;
          _mischiefChains.set(playerId, chain);
          spawnActionJuice(
            playerState,
            chain.combo > 1 ? `Mischief x${chain.combo}` : 'Mischief!',
            'mischief',
          );
        }

        if (next.smackStunTimer > 0 && prev.smackStunTimer <= 0) {
          spawnActionJuice(playerState, 'Smacked!', 'smack');
        }
      }
      _prevActionJuiceState.set(playerId, next);
    }

    for (const playerId of Array.from(_prevActionJuiceState.keys())) {
      if (!seen.has(playerId)) _prevActionJuiceState.delete(playerId);
    }
    for (const playerId of Array.from(_mischiefChains.keys())) {
      if (!seen.has(playerId)) _mischiefChains.delete(playerId);
    }
  }

  function buildScoreboardRows() {
    const lid = net.localId;
    if (!lid) return [];
    if (!net.connected) {
      const selfName = predictionState.displayName?.trim() || 'You';
      return [{
        label: `${selfName} (you)`,
        deaths: predictionState.deaths ?? 0,
        chaseSec: playerChaseRecordSeconds(predictionState),
        cheese: Math.max(0, Math.floor(predictionState.cheeseCarried ?? 0)),
      }];
    }
    const byId = new Map();
    byId.set(lid, net.serverState ?? predictionState);
    for (const [id, p] of net.remotePlayers) byId.set(id, p);
    const rows = [...byId.entries()].map(([id, p]) => ({
      label: scoreboardRowLabel(id, lid, p),
      deaths: p.deaths ?? 0,
      chaseSec: playerChaseRecordSeconds(p),
      cheese: Math.max(0, Math.floor(p.cheeseCarried ?? 0)),
      role: p.isAdversary ? 'Human' : 'Mouse',
      adversarySafeSeconds: p.adversarySafeSeconds ?? 0,
    }));
    rows.sort(
      (a, b) => b.chaseSec - a.chaseSec
        || b.cheese - a.cheese
        || b.deaths - a.deaths
        || a.label.localeCompare(b.label),
    );
    return rows.slice(0, 10);
  }

  function nearestRopeDistanceSq(ropesSnapshot, playerPos) {
    if (!Array.isArray(ropesSnapshot) || !playerPos) return Infinity;
    let nearestSq = Infinity;
    for (const rope of ropesSnapshot) {
      if (!Array.isArray(rope?.segments)) continue;
      for (const segment of rope.segments) {
        const dx = (Number(segment?.x) || 0) - playerPos.x;
        const dy = (Number(segment?.y) || 0) - (playerPos.y + 0.65);
        const dz = (Number(segment?.z) || 0) - playerPos.z;
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq < nearestSq) nearestSq = distSq;
      }
    }
    return nearestSq;
  }

  // Visual smoothing: render position lerps toward prediction to hide small corrections
  const renderPos = new THREE.Vector3();
  let renderPosInitialized = false;
  const RECONCILE_SNAP_THRESHOLD = 3.0; // teleport if error > this
  const RECONCILE_SKIP_THRESHOLD = 0.001; // ignore corrections smaller than this
  const RECONCILE_SMOOTH_RATE = 20; // lerp speed for corrections
  const PHYSICS_STEP = 1 / 30;
  const MAX_PHYSICS_STEPS = 4;
  let physicsAccum = 0;
  let previousJumpHeld = false;
  let ropePoseGraceUntil = 0;
  let localGrabAnimTimer = 0;
  let prevLocalGrabbedTarget = null;
  let prevLocalGrabbedBy = null;
  let prevLocalGrabbedBallId = null;

  function copyServerToPrediction(ss) {
    predictionState.position.x = ss.position.x;
    predictionState.position.y = ss.position.y;
    predictionState.position.z = ss.position.z;
    predictionState.velocity.x = ss.velocity.x;
    predictionState.velocity.y = ss.velocity.y;
    predictionState.velocity.z = ss.velocity.z;
    predictionState.rotation = ss.rotation;
    predictionState.grounded = ss.grounded;
    predictionState.stamina = ss.stamina;
    predictionState.staminaRegenTimer = ss.staminaRegenTimer;
    predictionState.health = ss.health;
    predictionState.alive = ss.alive;
    predictionState.sprinting = ss.sprinting;
    predictionState.crouching = ss.crouching;
    predictionState.sliding = ss.sliding;
    predictionState.slideTimer = ss.slideTimer;
    predictionState.slideCooldownTimer = ss.slideCooldownTimer;
    predictionState.slideDirX = ss.slideDirX;
    predictionState.slideDirZ = ss.slideDirZ;
    predictionState.canDoubleJump = ss.canDoubleJump;
    predictionState.hasDoubleJumped = ss.hasDoubleJumped;
    predictionState.wallHolding = !!ss.wallHolding;
    predictionState.wallNormalX = ss.wallNormalX ?? 0;
    predictionState.wallNormalZ = ss.wallNormalZ ?? 0;
    predictionState.wallJumpWindowTimer = ss.wallJumpWindowTimer ?? 0;
    predictionState.wallAttachCooldownTimer = ss.wallAttachCooldownTimer ?? 0;
    predictionState.deathTime = ss.deathTime ?? 0;
    predictionState.deaths = ss.deaths ?? 0;
    predictionState.longestChaseSeconds = ss.longestChaseSeconds ?? 0;
    predictionState.chaseStreakSeconds = ss.chaseStreakSeconds ?? 0;
    predictionState.cheeseCarried = ss.cheeseCarried ?? 0;
    // Mirror ropeSwing so simulateTick's rope early-return triggers during
    // client prediction. Without this, client keeps running ground physics
    // while server drives position via cannon rope, producing visible fight
    // between predicted and authoritative positions after re-grabs.
    predictionState.ropeSwing = ss.ropeSwing ?? null;
    predictionState.livesRemaining = ss.livesRemaining ?? predictionState.livesRemaining;
    predictionState.spectator = !!ss.spectator;
    predictionState.extracted = !!ss.extracted;
    predictionState.extractProgress = ss.extractProgress ?? 0;
    predictionState.animState = ss.animState ?? predictionState.animState;
    predictionState.isAdversary = !!ss.isAdversary;
    predictionState.adversaryRole = ss.adversaryRole ?? null;
    predictionState.adversarySafeSeconds = ss.adversarySafeSeconds ?? 0;
    predictionState.adversarySafeStreakSeconds = ss.adversarySafeStreakSeconds ?? 0;
    predictionState.isHero = !!ss.isHero;
    predictionState.heroAvatar = ss.heroAvatar ?? null;
    predictionState.heroAvailable = !!ss.heroAvailable;
    predictionState.heroAvatarAvailable = ss.heroAvatarAvailable ?? null;
    predictionState.heroTimeRemaining = ss.heroTimeRemaining ?? 0;
    if (ss.roundStats && typeof ss.roundStats === 'object') {
      predictionState.roundStats = { ...predictionState.roundStats, ...ss.roundStats };
    }
    if (typeof ss.displayName === 'string' && ss.displayName.trim()) {
      predictionState.displayName = ss.displayName;
    }
  }

  function reconcileWithServer() {
    if (net.serverSeq <= lastReconciledSeq) return;
    lastReconciledSeq = net.serverSeq;

    const ss = net.serverState;
    if (!ss) return;

    // Save pre-reconciliation predicted position
    const prevX = predictionState.position.x;
    const prevY = predictionState.position.y;
    const prevZ = predictionState.position.z;

    copyServerToPrediction(ss);

    const dt = 1 / 30;
    const colliders = getCollisionCollidersWithRoomba();
    for (const input of net.pendingInputs) {
      const vPull = vacuumPullForPrediction(net, predictionState);
      simulateTick(predictionState, input, dt, CLIENT_BOUNDS, colliders, vPull);
    }

    // Measure correction magnitude
    const dx = predictionState.position.x - prevX;
    const dy = predictionState.position.y - prevY;
    const dz = predictionState.position.z - prevZ;
    const errorSq = dx * dx + dy * dy + dz * dz;

    if (errorSq < RECONCILE_SKIP_THRESHOLD * RECONCILE_SKIP_THRESHOLD) {
      // Correction is negligible — revert to pre-reconciliation to avoid micro-jitter
      predictionState.position.x = prevX;
      predictionState.position.y = prevY;
      predictionState.position.z = prevZ;
    }
  }

  function snapLocalStateToServer(ss) {
    copyServerToPrediction(ss);
    localGrabAnimTimer = 0;
    prevLocalGrabbedTarget = ss?.grabbedTarget ?? null;
    prevLocalGrabbedBy = ss?.grabbedBy ?? null;
    prevLocalGrabbedBallId = ss?.grabbedBallId ?? null;
    mouse.setYaw(predictionState.rotation);
    previousJumpHeld = false;
    physicsAccum = 0;
    net.pendingInputs.length = 0;
    // Snap render position to spawn/teleport
    renderPos.set(
      predictionState.position.x,
      predictionState.position.y + mouse.groundOffset,
      predictionState.position.z,
    );
    renderPosInitialized = true;
  }

  net.on((data) => {
    if (data.type === 'init' && data.players?.[net.localId]) {
      snapLocalStateToServer(data.players[net.localId]);
      lastReconciledSeq = -2;
      return;
    }

    if (data.type === 'portal-spawn' && data.player?.id === net.localId) {
      snapLocalStateToServer(data.player);
      lastReconciledSeq = -2;
    }

    if (data.type === 'round-end') {
      roundRaid.showRoundEnd(data);
      const results = Array.isArray(data.results) ? data.results : [];
      for (const row of results) {
        const expression = row?.extracted ? 'sparklingHappy' : 'dizzy';
        if (row?.id === net.localId) {
          mouse.playEyeOneShot?.(expression, { duration: 4.0 });
        } else if (row?.id) {
          remotePlayerManager.playEyeOneShot(row.id, expression, { duration: 4.0 });
        }
      }
    }
  });

  if (net.localId && net.serverState) {
    snapLocalStateToServer(net.serverState);
  }

  function setMobileControls(mc) {
    mobileControls = mc;
  }

  const _adversaryHumanPos = new THREE.Vector3();
  let _humanWasPlayerControlled = false;
  let _prevHumanControlRot = null;
  let _humanControlTurn = 0;
  let _humanControlMoveDirection = 'straight';

  function findAdversaryPlayerState() {
    if (!net.connected) return null;
    if (net.serverState?.isAdversary) {
      return { id: net.localId, state: predictionState, local: true };
    }
    for (const [id, state] of net.remotePlayers) {
      if (state?.isAdversary) return { id, state, local: false };
    }
    return null;
  }

  function getAdversaryStatusPatch(isAlive) {
    const adversaryId = net.adversary?.playerId ?? null;
    const localIsAdversary = !!net.serverState?.isAdversary;
    const remoteAdversary = adversaryId && adversaryId !== net.localId
      ? net.remotePlayers.get(adversaryId)
      : null;
    const fallbackRemote = remoteAdversary
      ?? [...net.remotePlayers.values()].find((state) => state?.isAdversary);
    const activeState = localIsAdversary ? net.serverState : fallbackRemote;

    if (activeState?.isAdversary) {
      const streakSeconds = Math.max(0, Number(activeState.adversarySafeStreakSeconds) || 0);
      return {
        mode: localIsAdversary ? 'local' : 'remote',
        displayName: activeState.displayName || 'A player',
        safeSeconds: activeState.adversarySafeSeconds ?? 0,
        streakSeconds,
        hiding: streakSeconds > 0.08,
      };
    }

    const available = !!(
      net.connected
      && net.adversary?.available
      && net.round?.phase !== 'intermission'
      && isAlive
    );
    return { mode: available ? 'available' : 'off' };
  }

  function animationStateForHumanPlayer(state) {
    if (!state?.alive) return 'idle';
    if (!state.grounded) return 'jump';
    const vx = Number(state.velocity?.x) || 0;
    const vz = Number(state.velocity?.z) || 0;
    const speed = Math.hypot(vx, vz);
    if (speed > 5) return 'run';
    if (speed > 0.4) return 'walk';
    return 'idle';
  }

  function syncPlayableHuman(deltaSeconds) {
    if (!human) return;
    if (!perfFlags.predators) {
      if (_humanWasPlayerControlled) {
        human.setPlayerControlled(false);
        _humanWasPlayerControlled = false;
        _prevHumanControlRot = null;
        _humanControlTurn = 0;
        _humanControlMoveDirection = 'straight';
      }
      human.visible = false;
      mouse.visible = perfFlags.localPlayer;
      return;
    }
    const adversary = findAdversaryPlayerState();
    if (!adversary?.state?.position) {
      if (_humanWasPlayerControlled) {
        human.setPlayerControlled(false);
        _humanWasPlayerControlled = false;
        _prevHumanControlRot = null;
        _humanControlTurn = 0;
        _humanControlMoveDirection = 'straight';
      }
      mouse.visible = perfFlags.localPlayer;
      return;
    }

    const state = adversary.state;
    _humanWasPlayerControlled = true;
    human.setPlayerControlled(true);
    human.visible = true;
    _adversaryHumanPos.set(
      state.position.x ?? 0,
      state.position.y ?? 0,
      state.position.z ?? 0,
    );
    human.position.copy(_adversaryHumanPos);
    human.rotation.y = state.rotation ?? 0;
    const memeEmoteActive = state.emote === HUMAN_ADVERSARY_RAT_EMOTE_ID
      || (adversary.local && emoteManager.activeEmote?.id === HUMAN_ADVERSARY_RAT_EMOTE_ID);
    if (memeEmoteActive) {
      human.playPlayableMemeEmote?.();
      _prevHumanControlRot = human.rotation.y;
      _humanControlTurn = 0;
      mouse.visible = perfFlags.localPlayer && !adversary.local;
      return;
    }
    human.cancelPlayableMemeEmote?.();
    let rotDiff = _prevHumanControlRot == null ? 0 : human.rotation.y - _prevHumanControlRot;
    if (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
    if (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
    const turn = _prevHumanControlRot == null || deltaSeconds <= 0
      ? 0
      : THREE.MathUtils.clamp(rotDiff / Math.max(0.001, deltaSeconds) / 4.5, -1, 1);
    _humanControlTurn = dampValue(_humanControlTurn, turn, 12, deltaSeconds);
    _prevHumanControlRot = human.rotation.y;
    const vx = Number(state.velocity?.x) || 0;
    const vz = Number(state.velocity?.z) || 0;
    const speed = Math.hypot(vx, vz);
    const fx = Math.sin(human.rotation.y);
    const fz = Math.cos(human.rotation.y);
    const rx = Math.cos(human.rotation.y);
    const rz = -Math.sin(human.rotation.y);
    const localForward = vx * fx + vz * fz;
    const localRight = vx * rx + vz * rz;
    const backward = localForward < -0.2;
    const lateral = speed > 0.001 && localForward > 0.15 ? localRight / speed : 0;
    _humanControlMoveDirection = directionBucketFromLateral(_humanControlMoveDirection, lateral);
    human.setPlayableAnimation(animationStateForHumanPlayer(state), {
      turn: _humanControlTurn,
      backward,
      moveDirection: _humanControlMoveDirection,
    });

    mouse.visible = perfFlags.localPlayer && !adversary.local;
  }

  // --- Cinematic intro ---------------------------------------------------
  // Production boots through Cloudflare Turnstile + PartyKit connect + server
  // spawn — roughly 1–3s of staring at the client's pre-snap camera position
  // with a fully-rendered HUD. Instead of that, run a drone-style orbit over
  // the house with no UI until the server actually spawns our player. In dev
  // there's no Turnstile round-trip, so we enforce a 5s minimum to make the
  // intro visible / tweakable without having to deploy.
  const CINEMATIC_MIN_MS = offlineMode ? 0 : (import.meta.env.DEV ? 1000 : 0);
  const cinematicStartMs = performance.now();
  let cinematicActive = !offlineMode;
  const _cineLookAt = new THREE.Vector3(0, 1.2, 0);
  // Preserve the gameplay fog (near=16, far=68) and swap in a pushed-out fog
  // while the drone orbits so the house doesn't wash out at the larger radius.
  // Restored when the cinematic ends.
  const _cineSavedFog = scene.fog ? { near: scene.fog.near, far: scene.fog.far } : null;
  if (scene.fog) {
    scene.fog.near = 60;
    scene.fog.far = 220;
  }
  // The gameplay camera's far plane is 100, which would clip the far side of
  // the house at our wider orbit radius. Push it out for the intro and
  // restore on end so gameplay perf/depth precision is unchanged.
  const _cineSavedCameraFar = camera.far;
  camera.far = 260;
  camera.updateProjectionMatrix();

  function setCinematicUiHidden(hidden) {
    const shown = !hidden;
    // Gate each UI piece on the perf panel's own toggle so a dev who disabled
    // HUD via the perf panel doesn't have it reappear after the intro ends.
    hud.setVisible(shown && perfFlags.gameplayUi);
    roundRaid.setVisible(shown && perfFlags.gameplayUi);
    catLocator.setVisible(shown && perfFlags.gameplayUi);
    scoreboard.setVisible(shown && perfFlags.gameplayUi);
    toolbar.setVisible(shown && perfFlags.gameplayUi);
    chaseAlert.setVisible(shown && perfFlags.gameplayUi);
    adversaryStatus.setVisible(shown && perfFlags.gameplayUi);
    heroPrompt.setEnabled(shown && perfFlags.gameplayUi);
    actionJuice.setEnabled(shown && perfFlags.labels && perfFlags.gameplayUi);
    labelRenderer.domElement.style.display = (shown && perfFlags.labels) ? '' : 'none';
    // Don't render the local mouse while the drone is flying — we haven't
    // been spawned yet and the placeholder at world origin looks jarring.
    mouse.visible = shown
      && perfFlags.localPlayer
      && !(predictionState.isAdversary && human?.playerControlled);
    controller.setInputEnabled(shown);
    if (!shown) {
      // Release pointer lock if some earlier click acquired it before the
      // cinematic started (safety net; under normal boot it's never locked).
      if (document.pointerLockElement === canvas) document.exitPointerLock?.();
    }
  }
  setCinematicUiHidden(cinematicActive);

  function updateCinematicCamera(timeMs) {
    const t = Math.max(0, (timeMs - cinematicStartMs) * 0.001);
    // Slow orbit around the house centroid with a gentle vertical bob.
    const radius = 72;
    const baseHeight = 14;
    const angle = Math.PI + t * 0.14;
    camera.position.set(
      Math.cos(angle) * radius,
      baseHeight + Math.sin(t * 0.3) * 2.2,
      Math.sin(angle) * radius,
    );
    camera.lookAt(_cineLookAt);
    camera.updateMatrixWorld();
  }

  function isLocalPlayerSpawned() {
    if (!net.connected || !net.localId) return false;
    if (!renderPosInitialized) return false;
    const ss = net.serverState;
    if (!ss) return false;
    return ss.alive !== false;
  }

  function update(timeMs = 0, deltaSeconds = 1 / 60) {
    if (cinematicActive) {
      const elapsed = performance.now() - cinematicStartMs;
      if (elapsed >= CINEMATIC_MIN_MS && isLocalPlayerSpawned()) {
        cinematicActive = false;
        setCinematicUiHidden(false);
        if (_cineSavedFog && scene.fog) {
          scene.fog.near = _cineSavedFog.near;
          scene.fog.far = _cineSavedFog.far;
        }
        camera.far = _cineSavedCameraFar;
        camera.updateProjectionMatrix();
        // Snap render position to the freshly spawned player so there's no
        // lerp from the drone's last frame — the hand-off happens on the
        // same frame the HUD lights up.
        renderPos.set(
          predictionState.position.x,
          predictionState.position.y + mouse.groundOffset,
          predictionState.position.z,
        );
      } else {
        updateCinematicCamera(timeMs || performance.now());
        render();
        return {
          drawCalls: 0, triangles: 0, geometries: 0, textures: 0, programs: 0, bakeStats: null,
        };
      }
    }

    const nowSeconds = performance.now() * 0.001;
    occlusionFrameIndex += 1;

    gamepadManager.update(deltaSeconds);
    if (emoteWheel.isVisible() && getInputSource() === 'gamepad') {
      emoteWheel.setStickCursor(gamepadManager.leftStick.x, gamepadManager.leftStick.y);
    }

    if (roomba) {
      if (!perfFlags.predators) {
        roomba.visible = false;
        roomba.dockGroup.visible = false;
      } else if (net.connected) {
        const serverRoomba = pickRemoteRoombaSnapshot(net.remotePredators);
        if (serverRoomba) {
          roomba.applyServerState(serverRoomba);
          roomba.visible = true;
          roomba.dockGroup.visible = true;
        } else {
          roomba.visible = false;
          roomba.dockGroup.visible = false;
        }
      } else {
        roomba.visible = false;
        roomba.dockGroup.visible = false;
      }
      if (perfFlags.predators) roomba.update(deltaSeconds);
    }

    physicsAccum += deltaSeconds;

    let steps = 0;
    while (physicsAccum >= PHYSICS_STEP && steps < MAX_PHYSICS_STEPS) {
      physicsAccum -= PHYSICS_STEP;
      steps += 1;

      const keys = controller.keys;
      const kb = controller.keyBindings;

      const jumpHeld = !!keys[kb.jump];
      const jumpPressed = jumpHeld && !previousJumpHeld;
      previousJumpHeld = jumpHeld;

      let inputDir;
      const mc = mobileControls;
      const analog = controller.analogMove;
      if (mc && (mc.moveX !== 0 || mc.moveZ !== 0)) {
        inputDir = _physicsInputDir;
        _physicsForward.set(Math.sin(thirdPersonCamera.yaw), 0, Math.cos(thirdPersonCamera.yaw));
        _physicsRight.crossVectors(_physicsForward, _physicsWorldUp).normalize().negate();
        inputDir.set(0, 0, 0).addScaledVector(_physicsForward, mc.moveZ).addScaledVector(_physicsRight, mc.moveX);
        if (inputDir.lengthSq() > 0.0001) inputDir.normalize();
      } else if (analog) {
        inputDir = _physicsInputDir;
        _physicsForward.set(Math.sin(thirdPersonCamera.yaw), 0, Math.cos(thirdPersonCamera.yaw));
        _physicsRight.crossVectors(_physicsForward, _physicsWorldUp).normalize().negate();
        inputDir.set(0, 0, 0)
          .addScaledVector(_physicsForward, analog.z)
          .addScaledVector(_physicsRight, analog.x);
        const lenSq = inputDir.lengthSq();
        if (lenSq > 1) inputDir.multiplyScalar(1 / Math.sqrt(lenSq));
      } else {
        inputDir = thirdPersonCamera.getCameraRelativeMovement({
          forward: !!keys[kb.forward],
          backward: !!keys[kb.backward],
          back: !!keys[kb.backward],
          left: !!keys[kb.left],
          right: !!keys[kb.right],
        });
      }

      if (inputDir.lengthSq() > 0.01) {
        const targetAngle = Math.atan2(inputDir.x, inputDir.z);
        const diff = shortestAngleDelta(targetAngle, mouse.getYaw());
        mouse.rotateYaw(diff * Math.min(1, PHYSICS_STEP * 12));
      }

      const input = {
        moveX: inputDir.x,
        moveZ: inputDir.z,
        sprint: !!keys[kb.sprint],
        jump: jumpPressed,
        jumpPressed,
        jumpHeld,
        crouch: !!keys[kb.crouch],
        rotation: mouse.getYaw(),
      };

      const gameplayInterruptsHumanMeme = predictionState.isAdversary
        && emoteManager.activeEmote?.id === HUMAN_ADVERSARY_RAT_EMOTE_ID
        && (
          inputDir.lengthSq() > 0.01
          || jumpPressed
          || jumpHeld
          || !!keys[kb.sprint]
          || !!keys[kb.crouch]
          || !!keys[kb.grab]
          || !!keys[kb.ropeGrab]
          || !!keys[kb.interact]
          || !!keys[kb.drop]
          || !!keys[kb.heroActivate]
          || !!keys[kb.adversaryToggle]
        );
      if (gameplayInterruptsHumanMeme) {
        emoteManager.cancel();
      }

      const colliders = getCollisionCollidersWithRoomba();
      const vyBeforeJump = predictionState.velocity.y;
      const vPull = vacuumPullForPrediction(net, predictionState);
      simulateTick(predictionState, input, PHYSICS_STEP, CLIENT_BOUNDS, colliders, vPull);
      if (
        jumpPressed
        && predictionState.alive
        && !predictionState.isAdversary
        && predictionState.velocity.y > vyBeforeJump + 1.2
      ) {
        _physicsJumpSoundPos.set(
          predictionState.position.x,
          predictionState.position.y + mouse.groundOffset,
          predictionState.position.z,
        );
        audioManager.playSoundAtPosition('jump', _physicsJumpSoundPos);
      }

      // Update render position with smoothing to hide reconciliation corrections
      const targetX = predictionState.position.x;
      const targetY = predictionState.position.y + mouse.groundOffset;
      const targetZ = predictionState.position.z;

      if (!renderPosInitialized) {
        renderPos.set(targetX, targetY, targetZ);
        renderPosInitialized = true;
      } else {
        const errX = targetX - renderPos.x;
        const errY = targetY - renderPos.y;
        const errZ = targetZ - renderPos.z;
        const errSq = errX * errX + errY * errY + errZ * errZ;

        if (errSq > RECONCILE_SNAP_THRESHOLD * RECONCILE_SNAP_THRESHOLD) {
          // Large error (teleport/spawn) — snap immediately
          renderPos.set(targetX, targetY, targetZ);
        } else {
          // Smooth toward prediction target
          const t = 1 - Math.exp(-RECONCILE_SMOOTH_RATE * PHYSICS_STEP);
          renderPos.x += errX * t;
          renderPos.y += errY * t;
          renderPos.z += errZ * t;
        }
      }

      mouse.position.x = renderPos.x;
      mouse.position.y = renderPos.y;
      mouse.position.z = renderPos.z;

      controller.velocity.set(
        predictionState.velocity.x,
        predictionState.velocity.y,
        predictionState.velocity.z,
      );
      controller.grounded = predictionState.grounded;
      controller.wallHolding = !!predictionState.wallHolding;
      controller.sprinting = predictionState.sprinting;
      controller.crouching = predictionState.crouching;
      controller.sliding = predictionState.sliding;
      controller.stamina = predictionState.stamina;
      controller.health = predictionState.health;
      controller.alive = predictionState.alive;
      controller.forcedAnimationState = predictionState.extracted ? 'win' : null;
      if (controller.forcedAnimationState) {
        emoteManager.cancel();
      }
      const localGrabbedTarget = net.serverState?.grabbedTarget ?? null;
      const localGrabbedBy = net.serverState?.grabbedBy ?? null;
      const localGrabbedBallId = net.serverState?.grabbedBallId ?? null;
      const startedGrabAnim = (
        (!!localGrabbedTarget && !prevLocalGrabbedTarget)
        || (!!localGrabbedBy && !prevLocalGrabbedBy)
        || (!!localGrabbedBallId && !prevLocalGrabbedBallId)
      );
      if (startedGrabAnim) localGrabAnimTimer = GRAB_ONE_SHOT_ANIM_SECONDS;
      else localGrabAnimTimer = Math.max(0, localGrabAnimTimer - PHYSICS_STEP);
      prevLocalGrabbedTarget = localGrabbedTarget;
      prevLocalGrabbedBy = localGrabbedBy;
      prevLocalGrabbedBallId = localGrabbedBallId;
      controller.grabLocked = localGrabAnimTimer > 0;
      mouse.rotation.x = net.serverState?.grabbedBy ? Math.PI : 0;
      const cameraHumanMode = !!predictionState.isAdversary;
      const cameraArm = cameraHumanMode ? HUMAN_CAMERA_ARM_LENGTH : MOUSE_CAMERA_ARM_LENGTH;
      const cameraShoulderY = cameraHumanMode ? HUMAN_CAMERA_SHOULDER_Y : MOUSE_CAMERA_SHOULDER_Y;
      thirdPersonCamera.setArmLength(dampValue(thirdPersonCamera.armLength, cameraArm, 7, PHYSICS_STEP));
      thirdPersonCamera.shoulderOffset.y = dampValue(
        thirdPersonCamera.shoulderOffset.y,
        cameraShoulderY,
        9,
        PHYSICS_STEP,
      );

      controller._updateAnimation(PHYSICS_STEP);
      controller._updateCamera(PHYSICS_STEP);
      controller._handleAbilities();
      emoteManager.update(PHYSICS_STEP);

      if (net.connected) {
        const inputWithEmote = { ...input };
        if (emoteManager.isPlaying && emoteManager.activeEmote) {
          inputWithEmote.emote = emoteManager.activeEmote.id;
        }
        // Grab is held continuously; smack is a one-shot press.
        // Q unifies grab: server picks whichever is in proximity (mouse or rope).
        if (controller.grabHeld || controller.ropeGrabHeld) {
          inputWithEmote.grab = true;
          inputWithEmote.ropeGrab = true;
        }
        if (controller.smackPressed) {
          inputWithEmote.smack = true;
          controller.smackPressed = false;
          _smackFiredThisFrame = true;
        }
        if (controller.throwPressed) {
          inputWithEmote.throw = true;
          controller.throwPressed = false;
        }
        if (controller.heroActivatePressed) {
          inputWithEmote.heroActivate = true;
          controller.heroActivatePressed = false;
        }
        if (controller.adversaryTogglePressed) {
          inputWithEmote.adversaryToggle = true;
          controller.adversaryTogglePressed = false;
        }
        inputWithEmote.interactHeld = !!controller.interactHeld;
        net.sendInput(inputWithEmote);
        reconcileWithServer();
      }
    }

    if (steps >= MAX_PHYSICS_STEPS) {
      physicsAccum = 0;
    }

    if (perfFlags.predators) predatorManager?.update(deltaSeconds);

    if (cat && perfFlags.predators && net.connected) {
      const serverCat = net.remotePredators.get('cat-0');
      if (serverCat) {
        cat.applyServerState(serverCat);
        // Play cat sound on attack/roar transitions
        const catAi = serverCat.ai ?? 'idle';
        if ((catAi === 'attack' || catAi === 'roar') && _prevCatAiState !== catAi) {
          audioManager.playSoundAtPosition('cat', new THREE.Vector3(
            serverCat.px ?? 0, (serverCat.py ?? 0) + 0.5, serverCat.pz ?? 0,
          ));
        }
        _prevCatAiState = catAi;
      }
    }
    if (cat) {
      if (perfFlags.predators) cat.update(deltaSeconds);
      else cat.visible = false;
    }

    placementMode?.update(deltaSeconds);
    room.updateLoot(timeMs);
    vibePortalManager.update(deltaSeconds);

    if (net.connected) {
      remotePlayerManager.sync(net.remotePlayers);
      if (perfFlags.remotePlayers) {
        remotePlayerManager.update(deltaSeconds, camera, occlusionFrameIndex);
      }

      // Detect smack / grab transitions and play spatial audio
      const allPlayers = new Map(net.remotePlayers);
      if (net.serverState) allPlayers.set(net.localId, net.serverState);
      syncActionJuicePopups(allPlayers, nowSeconds);
      for (const [pid, pState] of allPlayers) {
        const prevStun = _prevSmackStun.get(pid) ?? 0;
        const curStun = pState.smackStunTimer ?? 0;
        if (curStun > 0 && prevStun <= 0) {
          // Just got smacked — play slap sound at their position
          _spatialEventPos.set(pState.position.x, pState.position.y + 0.5, pState.position.z);
          audioManager.playSoundAtPosition('smack', _spatialEventPos);
          if (pid === net.localId) {
            mouse.playEyeOneShot?.('panicUp', { duration: 0.75 });
          } else {
            remotePlayerManager.playEyeOneShot(pid, 'panicUp', { duration: 0.75 });
          }
        }
        _prevSmackStun.set(pid, curStun);

        const prevGrab = _prevGrabbedTarget.get(pid) ?? null;
        const curGrab = pState.grabbedTarget ?? null;
        if (curGrab && !prevGrab) {
          // Just initiated a grab — play grab sound at their position
          _spatialEventPos.set(pState.position.x, pState.position.y + 0.5, pState.position.z);
          audioManager.playSoundAtPosition('grab', _spatialEventPos);
        }
        _prevGrabbedTarget.set(pid, curGrab);
      }
      // Clean up stale entries
      for (const pid of _prevSmackStun.keys()) {
        if (!allPlayers.has(pid)) {
          _prevSmackStun.delete(pid);
          _prevGrabbedTarget.delete(pid);
        }
      }
    }
    syncPlayableHuman(deltaSeconds);

    const isAlive = controller.alive;
    const deathTime = net.serverState?.deathTime ?? 0;
    const respawnCountdown = !isAlive && deathTime > 0 && !(net.serverState?.spectator)
      ? Math.max(0, 8 - (Date.now() / 1000 - deathTime))
      : 0;

    const remotePlayers = [...net.remotePlayers.keys()];
    const botCount = remotePlayers.filter((id) => typeof id === 'string' && id.startsWith('bot-')).length;
    const connectedCount = net.connected ? 1 + (remotePlayers.length - botCount) : 1;
    const playerCount = connectedCount + botCount;
    hud.update({
      stamina: controller.staminaPercent,
      health: controller.healthPercent,
      ping: net.ping,
      playerCount,
      connectedCount,
      botCount,
      cheese: net.connected
        ? (net.serverState?.cheeseCarried ?? 0)
        : Math.max(0, Math.floor(predictionState.cheeseCarried ?? 0)),
      lives: net.connected
        ? (net.serverState?.livesRemaining ?? 2)
        : (predictionState.livesRemaining ?? 2),
      heroAvatar: net.connected
        ? (net.serverState?.heroAvatar ?? null)
        : (predictionState.heroAvatar ?? null),
      heroTimeRemaining: net.connected
        ? (net.serverState?.heroTimeRemaining ?? 0)
        : (predictionState.heroTimeRemaining ?? 0),
      alive: isAlive,
      respawnCountdown,
    });

    heroPrompt.setVisible(
      perfFlags.gameplayUi && !!(net.serverState?.heroAvailable && !net.serverState?.isHero && isAlive),
      net.serverState?.heroAvatarAvailable ?? null,
    );
    const isAdversaryNow = !!net.serverState?.isAdversary && isAlive;
    const isHeroNow = !!net.serverState?.isHero && isAlive && !isAdversaryNow;
    ensureLocalHeroBrain(isHeroNow, net.serverState?.heroAvatar);
    if (isHeroNow !== _wasHero) {
      _wasHero = isHeroNow;
      if (isHeroNow) {
        audioManager.startHeroMusic?.();
      } else {
        audioManager.stopHeroMusic?.();
      }
    }
    if (localHeroBrain) {
      localHeroBrain.setState(controller._prevAnimState ?? 'idle');
      localHeroBrain.update(deltaSeconds);
    }

    const humanRolePatch = getAdversaryStatusPatch(isAlive);
    adversaryStatus.update(humanRolePatch);
    hud.updateHumanRole(humanRolePatch);

    roundRaid.updatePhaseBanner(net.connected ? net.round : null, Date.now() / 1000, {
      subtitle: (net.round?.phase === 'extract' && (net.serverState?.extractProgress ?? 0) > 0.02)
        ? `Extract ${Math.round((net.serverState?.extractProgress ?? 0) * 100)}%`
        : '',
    });

    const currentPhase = net.connected ? (net.round?.phase ?? null) : null;
    if (currentPhase !== _prevRoundPhase) {
      if (currentPhase === 'extract' && _prevRoundPhase !== null) {
        audioManager.playExtractCountdown?.();
      }
      if (currentPhase === 'intermission') {
        audioManager.startIntermissionMusic?.();
      } else if (_prevRoundPhase === 'intermission') {
        audioManager.stopIntermissionMusic?.();
      }
      _prevRoundPhase = currentPhase;
    }

    if (net.connected && Array.isArray(net.extractionPortals) && net.extractionPortals.length > 0) {
      while (extractionMarkerGroup.children.length < net.extractionPortals.length) {
        const ring = new THREE.Mesh(_portalRingGeo, _portalRingMat);
        ring.rotation.x = -Math.PI / 2;
        ring.renderOrder = 10;
        extractionMarkerGroup.add(ring);
      }
      extractionMarkerGroup.visible = perfFlags.raidMarkers;
      net.extractionPortals.forEach((p, i) => {
        const m = extractionMarkerGroup.children[i];
        if (!m) return;
        m.position.set(p.x ?? 0, (p.y ?? 0) + 0.03, p.z ?? 0);
      });
    } else {
      extractionMarkerGroup.visible = false;
    }
    const scoreboardRows = buildScoreboardRows();
    scoreboard.setRows(scoreboardRows);
    toolbar.setLeaderboardRows(scoreboardRows);

    const chaseStreak = net.connected
      ? (net.serverState?.chaseStreakSeconds ?? 0)
      : 0;
    chaseAlert.update({
      active: !!(controller.alive && chaseStreak > 0.02),
      streakSeconds: chaseStreak,
    });

    if (perfFlags.gameplayUi && cat && ENABLE_CAT_PREDATOR) {
      catLocator.update({
        camera,
        canvasRect: canvas.getBoundingClientRect(),
        catWorldPos: cat.position,
        catAlive: !!cat.alive,
      });
    } else {
      catLocator.update({});
    }

    const balls = net.pushBalls;
    const localHeldTarget = !!(net.serverState?.grabbedTarget || net.serverState?.grabbedBallId);
    controller.throwOnInteractWhileGrabHeld = localHeldTarget;
    const ropeDistanceSq = nearestRopeDistanceSq(net.ropes, predictionState.position);
    const ropeGrabAssistActive = !!(
      controller.ropeGrabHeld
      && !predictionState.grounded
      && ropeDistanceSq <= ROPE_HINT_RANGE * ROPE_HINT_RANGE
    );
    const ropePoseSignal = !!(net.serverState?.ropeSwing || predictionState.ropeSwing || ropeGrabAssistActive);
    if (ropePoseSignal) ropePoseGraceUntil = nowSeconds + ROPE_POSE_GRACE_SECONDS;
    const ropePoseActive = ropePoseSignal || nowSeconds < ropePoseGraceUntil;
    if (pushBallsRenderVisible && net.connected && Array.isArray(balls) && balls.length > 0) {
      const seen = new Set();
      let count = 0;
      for (const b of balls) {
        if (!b?.id) continue;
        if (count >= PUSH_BALL_MAX_INSTANCES) break;
        seen.add(b.id);
        const r = typeof b.r === 'number' && b.r > 0 ? b.r : DEFAULT_PUSH_BALL_RADIUS;
        let state = pushBallStates.get(b.id);
        if (!state) {
          state = {
            smoothPos: new THREE.Vector3(b.x, b.y, b.z),
            smoothQuat: new THREE.Quaternion(b.qx, b.qy, b.qz, b.qw),
            targetPos: new THREE.Vector3(b.x, b.y, b.z),
            targetQuat: new THREE.Quaternion(b.qx, b.qy, b.qz, b.qw),
            radius: r,
          };
          pushBallStates.set(b.id, state);
        }
        state.targetPos.set(b.x, b.y, b.z);
        state.targetQuat.set(b.qx, b.qy, b.qz, b.qw);
        state.smoothPos.lerp(state.targetPos, 0.42);
        state.smoothQuat.slerp(state.targetQuat, 0.42);
        state.radius = r;

        _pushBallScale.setScalar(r);
        _pushBallMatrix.compose(state.smoothPos, state.smoothQuat, _pushBallScale);
        pushBallInstanced.setMatrixAt(count, _pushBallMatrix);
        _pushBallColor.set(typeof b.color === 'string' && b.color ? b.color : '#e8945c');
        pushBallInstanced.setColorAt(count, _pushBallColor);
        count++;
      }
      for (const id of Array.from(pushBallStates.keys())) {
        if (!seen.has(id)) pushBallStates.delete(id);
      }
      pushBallInstanced.count = count;
      pushBallInstanced.instanceMatrix.needsUpdate = true;
      if (pushBallInstanced.instanceColor) pushBallInstanced.instanceColor.needsUpdate = true;
      pushBallInstanced.visible = count > 0;
    } else {
      pushBallInstanced.count = 0;
      pushBallInstanced.visible = false;
      if (pushBallStates.size > 0) pushBallStates.clear();
    }

    // Context-aware hints for held objects, ropes, and ball handling.
    let nextHint = null;
    if (localHeldTarget && controller.alive) {
      nextHint = isCoarsePointer
        ? { id: 'throwHeldBall', key: 'SMACK', text: 'Throw what you are holding' }
        : { id: 'throwHeldBall', action: 'smack', text: 'Throw what you are holding' };
    } else if (ropePoseActive && controller.alive) {
      nextHint = {
        id: 'ropeSwing',
        items: isCoarsePointer
          ? [
            { key: 'STICK', text: 'Swing on the rope' },
            { key: 'JUMP', text: 'Jump up the rope' },
          ]
          : [
            { key: 'WASD', text: 'Swing on the rope' },
            { action: 'jump', text: 'Jump up the rope' },
          ],
      };
    } else if (
      controller.alive
      && ropeDistanceSq <= ROPE_HINT_RANGE * ROPE_HINT_RANGE
    ) {
      nextHint = {
        id: 'ropeGrab',
        items: isCoarsePointer
          ? [
            { key: 'JUMP', text: 'Jump toward the rope' },
            { key: 'ROPE', text: 'Hold to grab the rope' },
          ]
          : [
            { action: 'jump', text: 'Jump toward the rope' },
            { action: 'grab', text: 'Hold to grab the rope' },
          ],
      };
    } else if (Date.now() >= smackBallHintCooldownUntil && Array.isArray(balls) && balls.length > 0 && controller.alive) {
      let nearestSq = Infinity;
      for (const b of balls) {
        const dx = b.x - mouse.position.x;
        const dz = b.z - mouse.position.z;
        const dSq = dx * dx + dz * dz;
        if (dSq < nearestSq) nearestSq = dSq;
      }
      if (nearestSq < 2.5 * 2.5) {
        nextHint = {
          id: 'smackBall',
          items: isCoarsePointer
            ? [
              { key: 'SMACK', text: 'Smack the ball' },
              { key: 'GRAB', text: 'Pick up the ball' },
            ]
            : [
              { action: 'smack', text: 'Smack the ball' },
              { action: 'grab', text: 'Pick up the ball' },
            ],
        };
        if (_smackFiredThisFrame) {
          smackBallHintCooldownUntil = Date.now() + SMACK_BALL_HINT_COOLDOWN_MS;
          nextHint = null;
        }
      }
    }
    const nextHintId = nextHint?.id ?? null;
    if (nextHintId !== activeHintId) {
      activeHintId = nextHintId;
      hud.update({ hint: perfFlags.gameplayUi ? nextHint : null });
    }
    _smackFiredThisFrame = false;

    const ropeLayout = room.getEditableLayout?.()?.ropes ?? [];
    const ropeStyleById = new Map(
      ropeLayout.map((r) => {
        const n = normalizeRope(r);
        return [n.id, { segmentRadius: n.segmentRadius, color: n.color, texture: n.texture }];
      }),
    );
    if (perfFlags.ropes) {
      ropeSystem.update(net.connected ? net.ropes : [], ropeStyleById);
    } else {
      ropeSystem.update([], ropeStyleById);
    }

    const cheeseList = net.connected ? net.cheesePickups : [];
    if (net.connected && Array.isArray(cheeseList) && cheeseList.length > 0) {
      const seenCheese = new Set();
      let cheeseCount = 0;
      for (const c of cheeseList) {
        if (!c?.id) continue;
        if (cheeseCount >= CHEESE_PICKUP_MAX_INSTANCES) break;
        seenCheese.add(c.id);
        let state = cheesePickupStates.get(c.id);
        if (!state) {
          state = { phase: Math.random() * Math.PI * 2, spinY: 0 };
          cheesePickupStates.set(c.id, state);
        }
        state.spinY += deltaSeconds * 0.65;
        const baseY = (typeof c.y === 'number' ? c.y : 0) + 0.14;
        _cheesePos.set(
          typeof c.x === 'number' ? c.x : 0,
          baseY + Math.sin(timeMs * 0.002 * 2.1 + state.phase) * 0.07,
          typeof c.z === 'number' ? c.z : 0,
        );
        _cheeseEuler.set(0, state.spinY, 0);
        _cheeseQuat.setFromEuler(_cheeseEuler);
        _cheeseScale.setScalar(cheesePickupVisualScale(c.amount));
        _cheeseMatrix.compose(_cheesePos, _cheeseQuat, _cheeseScale);
        cheesePickupInstanced.setMatrixAt(cheeseCount, _cheeseMatrix);
        cheeseCount += 1;
      }
      for (const id of Array.from(cheesePickupStates.keys())) {
        if (!seenCheese.has(id)) cheesePickupStates.delete(id);
      }
      cheesePickupInstanced.count = cheeseCount;
      cheesePickupInstanced.instanceMatrix.needsUpdate = true;
      cheesePickupInstanced.visible = cheeseCount > 0;
    } else {
      cheesePickupInstanced.count = 0;
      cheesePickupInstanced.visible = false;
      if (cheesePickupStates.size > 0) cheesePickupStates.clear();
    }

    occlusionFader.update(deltaSeconds);
    taskController.update(deltaSeconds);
    unlockCollectibles.update(deltaSeconds);
    if (!perfFlags.gameplayUi) {
      taskPromptElement.style.display = 'none';
    }

    if (perfFlags.labels) {
      localNameplate.setText(predictionState.displayName || getClientPreferredDisplayName());
      localNameplate.setAlive(predictionState.alive !== false);
      const localNameplateTarget = predictionState.isAdversary && human?.playerControlled ? human : mouse;
      syncNameplateWorldPosition(
        localNameplateAnchor,
        localNameplateTarget,
        predictionState.isAdversary ? HUMAN_NAMEPLATE_OFFSET_Y : undefined,
      );
      localNameplateAnchor.getWorldPosition(_localNameplateWorld);
      localNameplate.setOccluded(
        isNameplateOccluded(scene, camera, _localNameplateWorld, localNameplateTarget, occlusionFrameIndex),
      );
    } else {
      localNameplate.setOccluded(true);
    }

    audioManager.setAmbientChaseTarget(isLocalPlayerCatHuntTarget());
    const keys = controller.keys;
    const kb = controller.keyBindings;
    const keyboardMove =
      !!keys[kb.forward] || !!keys[kb.backward] || !!keys[kb.left] || !!keys[kb.right];
    const stickMove =
      !!mobileControls
      && (Math.abs(mobileControls.moveX) > 0.02 || Math.abs(mobileControls.moveZ) > 0.02);
    const movementIntent = keyboardMove || stickMove;
    const hSpeed = Math.hypot(predictionState.velocity.x, predictionState.velocity.z);
    const suppressMouseMovementAudio = !!predictionState.isAdversary;
    const movementBed =
      predictionState.alive &&
      !suppressMouseMovementAudio &&
      predictionState.grounded &&
      (movementIntent
        || predictionState.animState === 'walk'
        || predictionState.animState === 'run'
        || hSpeed > 0.35);
    const wallRunBed =
      predictionState.alive &&
      !suppressMouseMovementAudio &&
      predictionState.wallHolding &&
      !predictionState.grounded &&
      (movementIntent || hSpeed > 0.22);
    audioManager.setMovementLoopTarget(movementBed);
    audioManager.setMovementSprintTarget(movementBed && predictionState.sprinting);
    audioManager.setMovementWallRunTarget(wallRunBed);
    if (ENABLE_ROOMBA_PREDATOR && roomba) {
      audioManager.updateRoombaMotor(
        roomba.visible ? roomba.position : null,
        roomba.visible ? roomba.motorPhase : 'charging',
      );
    } else {
      audioManager.updateRoombaMotor(null, 'charging');
    }
    audioManager.update(deltaSeconds);

    // --- Parkour feel: speed-based FOV push, screen speed lines, animation rate sync.
    {
      const vx = predictionState.velocity.x;
      const vy = predictionState.velocity.y;
      const vz = predictionState.velocity.z;
      const horizSpeed = Math.hypot(vx, vz);
      // Normalize against sprint speed (~9 m/s); boost further for wall-run & fast airborne.
      const sprintT = Math.min(1, Math.max(0, (horizSpeed - 4.0) / 5.0));
      let fovBoost = sprintT * 8;
      if (predictionState.wallHolding) fovBoost += 4;
      if (!predictionState.grounded && horizSpeed > 6) fovBoost += 2;
      thirdPersonCamera.setTargetFov(60 + fovBoost);
      // Wind overlay only while actively sprinting (or wall-running at speed) — not during
      // normal walk/jog. Scales smoothly within that range so it fades in/out with intent.
      const windT = predictionState.sprinting
        ? sprintT
        : (predictionState.wallHolding && horizSpeed > 3 ? 0.55 : 0);
      if (perfFlags.wind) {
        windStreaks.setIntensity(windT);
        windStreaks.update(deltaSeconds);
      } else {
        windStreaks.setIntensity(0);
        windStreaks.update(deltaSeconds);
      }

      // --- Wall-run / wall-climb body lean (visual only) ---
      // Applied to mouse.avatar (inner transform) so the outer Mouse group's
      // yaw-driven rotation.y stays clean. Smooth-lerped toward target each
      // frame so transitions in and out feel organic.
      // Apply lean to the body pivot (not the animated avatar root) so the
      // AnimationMixer doesn't overwrite our pitch/roll every frame.
      const avatar = mouse?.bodyPivot ?? mouse?.avatar;
      if (avatar) {
        let targetRoll = 0;
        let targetPitch = 0;
        const onRope = ropePoseActive;
        if (onRope) {
          // Rope climb: same pose as wall-climb. Belly against the rope, nose
          // pointing up, back facing outward.
          targetPitch = -Math.PI / 2;
          targetRoll = 0;
        } else if (predictionState.wallHolding) {
          const nx = predictionState.wallNormalX;
          const nz = predictionState.wallNormalZ;
          const yaw = mouse.getYaw();
          // Player local right in world (when facing +Z locally at yaw=0, right is +X).
          const rx = Math.cos(yaw);
          const rz = -Math.sin(yaw);
          const rightDotNormal = rx * nx + rz * nz;
          // Player local forward in world.
          const fx = Math.sin(yaw);
          const fz = Math.cos(yaw);
          const intoWall = -(fx * nx + fz * nz); // 1 if facing directly at wall
          if (intoWall > 0.35) {
            // Climbing: mouse lies flat against the wall with belly toward the
            // surface, back facing away, nose pointing up the wall. That means
            // the avatar's local +Z (forward/nose) needs to map to world +Y.
            // A negative pitch about local X achieves: +Z -> +Y (nose up) and
            // -Y (belly) -> +Z (into wall).
            targetPitch = -Math.PI / 2;
            targetRoll = 0;
          } else {
            // Wall running: lean 45° away from wall, feet act as the pivot.
            const side = rightDotNormal < 0 ? 1 : -1; // wall on right -> lean left (+z)
            targetRoll = side * (Math.PI / 4);
            targetPitch = 0;
          }
        }
        const leanBlend = 1 - Math.exp(-9 * deltaSeconds);
        avatar.rotation.z += (targetRoll - avatar.rotation.z) * leanBlend;
        avatar.rotation.x += (targetPitch - avatar.rotation.x) * leanBlend;
      }
      // Match locomotion clip playback rate to actual horizontal speed so sprint
      // doesn't look like shuffling feet. Walk base rate is already 3.5; use
      // relative ratios so the authored base stays dominant.
      const animRate = Math.max(0.6, Math.min(1.9, horizSpeed / 6.0 + 0.35));
      mouse?.animationManager?.setPlaybackRate?.(animRate);
    }

    actionJuice.update(deltaSeconds);
    render();
    const info = renderer.info;
    return {
      drawCalls: info?.render?.calls ?? 0,
      triangles: info?.render?.triangles ?? 0,
      geometries: info?.memory?.geometries ?? 0,
      textures: info?.memory?.textures ?? 0,
      programs: info?.programs?.length ?? 0,
      bakeStats: room.getStaticBakeStats?.() ?? null,
    };
  }

  function dispose() {
    navMeshOverlay.traverse((child) => {
      child.geometry?.dispose?.();
      if (Array.isArray(child.material)) {
        child.material.forEach((material) => material?.dispose?.());
      } else {
        child.material?.dispose?.();
      }
    });
    placementMode?.deactivate();
    gamepadManager.dispose();
    net.disconnect();
    remotePlayerManager.dispose();
    predatorManager?.dispose();
    emoteWheel.dispose();
    heroPrompt.dispose();
    vibePortalManager.dispose();
    scoreboard.dispose();
    chaseAlert.dispose();
    windStreaks.dispose();
    toolbar.dispose();
    scene.remove(ropeSystem);
    ropeSystem.dispose();
    scene.remove(pushBallInstanced);
    pushBallInstanced.dispose?.();
    pushBallUnitGeometry.dispose();
    pushBallSharedMaterial.dispose();
    pushBallStates.clear();
    cheesePickupGroup.remove(cheesePickupInstanced);
    cheesePickupInstanced.dispose?.();
    cheesePickupGeometry.dispose();
    cheesePickupMaterial.dispose();
    cheesePickupStates.clear();
    scene.remove(cheesePickupGroup);
    scene.remove(extractionMarkerGroup);
    _portalRingGeo.dispose();
    _portalRingMat.dispose();
    roundRaid.dispose();
    hud.dispose();
    catLocator.dispose();
    audioManager.stopAmbientBed();
    audioManager.stopMovementLoop();
    localNameplate.dispose();
    adversaryStatus.dispose();
    if (_humanWasPlayerControlled) human?.setPlayerControlled(false);
    scene.remove(localNameplateAnchor);
    taskController.dispose();
    unlockCollectibles.dispose();
    actionJuice.dispose();
    taskPromptElement.remove();
    labelRenderer.domElement.remove();
    outlinePipeline.dispose();
    renderer.dispose();
  }

  function spawnExtraBall() {
    if (net.connected) net.sendSpawnExtraBall();
  }

  function wirePerformancePanel(panel) {
    if (!panel?.bindPerformanceToggles) return;
    panel.bindPerformanceToggles({
      shadows: {
        label: 'Shadow maps (extra passes per light)',
        get: () => renderer.shadowMap.enabled,
        set: (v) => {
          renderer.shadowMap.enabled = !!v;
        },
      },
      staticMerge: {
        label: 'Static geometry merge (combine by material)',
        get: () => room.isStaticMergeEnabled?.() === true,
        set: (v) => room.setStaticMergeEnabled?.(!!v),
      },
      fullscreenOutline: {
        label: 'Fullscreen outline (post-process)',
        get: () => outlinePipeline.isEnabled(),
        set: (v) => outlinePipeline.setEnabled(v),
      },
      roomOutlines: {
        label: 'Room edge outlines (batched)',
        get: () => roomOutlineMeshes.some((m) => m && m.visible !== false),
        set: (v) => setOutlineListVisible(roomOutlineMeshes, v),
      },
      localMouseOutlines: {
        label: 'Local mouse edge outlines (per mesh)',
        get: () => localMouseOutlineMeshes.some((m) => m && m.visible !== false),
        set: (v) => setOutlineListVisible(localMouseOutlineMeshes, v),
      },
      remoteMouseOutlines: {
        label: 'Remote mouse edge outlines',
        get: () => remotePlayerManager.getEdgeOutlinesVisible(),
        set: (v) => remotePlayerManager.setEdgeOutlinesVisible(v),
      },
      labels: {
        label: 'CSS labels / nameplates',
        get: () => perfFlags.labels,
        set: (v) => setLabelsEnabled(v),
      },
      gameplayUi: {
        label: 'HUD / overlays / toolbar',
        get: () => perfFlags.gameplayUi,
        set: (v) => setGameplayUiEnabled(v),
      },
      localPlayer: {
        label: 'Local player model',
        get: () => perfFlags.localPlayer,
        set: (v) => setLocalPlayerVisible(v),
      },
      remotePlayers: {
        label: 'Remote player models',
        get: () => perfFlags.remotePlayers,
        set: (v) => setRemotePlayersVisible(v),
      },
      predators: {
        label: 'Predator models (cat / roomba / human)',
        get: () => perfFlags.predators,
        set: (v) => setPredatorsVisible(v),
      },
      navOverlay: {
        label: 'Nav mesh overlay',
        get: () => navMeshOverlay.visible === true,
        set: (v) => {
          navMeshOverlay.visible = !!v;
        },
      },
      vibePortals: {
        label: 'Vibe portals (rings / particles / sprites)',
        get: () => vibePortalManager.getPortalsVisible(),
        set: (v) => vibePortalManager.setPortalsVisible(v),
      },
      cheesePickups: {
        label: 'Cheese pickup meshes',
        get: () => cheesePickupGroup.visible !== false,
        set: (v) => {
          cheesePickupGroup.visible = !!v;
        },
      },
      pushBalls: {
        label: 'Push ball meshes',
        get: () => pushBallsRenderVisible,
        set: (v) => {
          pushBallsRenderVisible = !!v;
          if (!pushBallsRenderVisible) {
            pushBallInstanced.count = 0;
            pushBallInstanced.visible = false;
          }
        },
      },
      wind: {
        label: 'Wind streaks',
        get: () => perfFlags.wind,
        set: (v) => setWindVisible(v),
      },
      ropes: {
        label: 'Rope visuals',
        get: () => perfFlags.ropes,
        set: (v) => setRopesVisible(v),
      },
      raidMarkers: {
        label: 'Raid / extraction markers',
        get: () => perfFlags.raidMarkers,
        set: (v) => setRaidMarkersVisible(v),
      },
      occlusionFader: {
        label: 'Occlusion x-ray fader (wall fade)',
        get: () => occlusionFader.enabled !== false,
        set: (v) => occlusionFader.setEnabled(v),
      },
      grass: {
        label: 'Grass (vegetation instanced cards)',
        get: () => room.vegetationSystem?.isKindVisible('grass') !== false,
        set: (v) => room.vegetationSystem?.setKindVisible('grass', v),
      },
      trees: {
        label: 'Trees (vegetation canopies + trunks)',
        get: () => room.vegetationSystem?.isKindVisible('tree') !== false,
        set: (v) => room.vegetationSystem?.setKindVisible('tree', v),
      },
    });
  }

  return {
    mode: 'webgl',
    renderer,
    scene,
    camera,
    room,
    mouse,
    bunny,
    cat,
    predatorManager,
    placementMode,
    thirdPersonCamera,
    controller,
    hud,
    net,
    emoteManager,
    emoteWheel,
    resize,
    update,
    dispose,
    setMobileControls,
    spawnExtraBall,
    toggleNavMeshOverlay(forceVisible) {
      navMeshOverlay.visible = typeof forceVisible === 'boolean'
        ? forceVisible
        : !navMeshOverlay.visible;
      return navMeshOverlay.visible;
    },
    bindPerformancePanel: wirePerformancePanel,
  };
}

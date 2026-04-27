import * as THREE from 'three';
import { applyAtmosphere, buildNavMeshOverlay, createWebGLRenderer } from './sessionScene.js';
import { createOfflineNetClient } from './offlineNetClient.js';
import { readAudioPrefs, writeAudioPrefs } from './audioPrefs.js';
import { buildScoreboardRows } from './scoreboardRows.js';
import { syncActionJuicePopups } from './actionJuiceSync.js';
import { bindPerformancePanelToggles } from './performancePanelBindings.js';
import { createPerformanceToggles } from './performanceToggles.js';
import {
  createExtractHoldRing,
  hideExtractHoldRing,
  updateExtractHoldRing,
} from './extractHoldRing.js';
import { createExtractionPortalMarkers } from './extractionPortalMarkers.js';
import {
  createPerfFlags,
  createQualityState,
  updateAdaptiveQuality,
} from './adaptiveQuality.js';
import {
  ROPE_HINT_RANGE,
  ROPE_POSE_GRACE_SECONDS,
  buildGameplayHint,
  nearestRopeDistanceSq,
} from './gameplayHints.js';
import { createDynamicWorldItems } from './dynamicWorldItems.js';
import {
  CHARGED_THROW_CAMERA_SIDE_OFFSET,
  LOCAL_CHARGED_THROW_ORBIT_SPEED,
  createChargedThrowTracer,
  disposeChargedThrowTracer,
  getChargedThrowAimDirection,
  updateChargedThrowTracer,
} from './chargedThrowAim.js';
import {
  copyServerToPrediction,
  createRenderPositionSmoother,
  restoreTinyPredictionCorrection,
} from './localPredictionSync.js';
import { handleHeroUnlockMarkerMessage } from './heroUnlockMarkerVisuals.js';
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
import {
  CharacterController,
  CHARGED_JUMP_FULL_HOLD_MS,
  CHARGED_JUMP_INDICATOR_HOLD_MS,
  CHARGED_JUMP_MIN_HOLD_MS,
  CHARGED_SMACK_INDICATOR_HOLD_MS,
  CHARGED_THROW_INDICATOR_HOLD_MS,
  QUICK_TOSS_INDICATOR_HOLD_MS,
} from '../controllers/CharacterController.js';
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
import { createHoldActionReticle } from '../hud/HoldActionReticle.js';
import { MischiefMeter } from '../hud/MischiefMeter.jsx';
import { OnboardingOverlay } from '../hud/OnboardingOverlay.jsx';
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
import { BurnEffect } from '../effects/BurnEffect.js';
import { getAudioManager } from '../audio/AudioManager.js';
import { OcclusionFader } from '../utils/OcclusionFader.js';
import { createPlayerNameplate, syncNameplateWorldPosition } from '../world/PlayerNameplate.js';
import { isNameplateOccluded } from '../utils/nameplateOcclusion.js';
import {
  getClientPreferredDisplayName,
  setClientPreferredDisplayName,
} from '../utils/playerDisplayName.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { simulateTick, createPlayerState } from '../../shared/physics.js';
import { getRoombaVacuumPullAcceleration } from '../../shared/roomba.js';
import { readVibePortalArrivalFromSearch } from '../../shared/vibePortal.js';
import kitchenNavMesh from '../../shared/kitchen-navmesh.generated.js';
import { LEVEL_WORLD_BOUNDS_XZ } from '../../shared/levelWorldBounds.js';
import { normalizeRope } from '../../shared/ropes.js';
import { collectSpawnPointsFromLayout } from '../../shared/spawnPoints.js';

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
const MOUNT_CAMERA_ARM_LENGTH = 4.8;
const HUMAN_CAMERA_ARM_LENGTH = 8.5;
const MOUSE_CAMERA_SHOULDER_Y = 1.3;
const MOUNT_CAMERA_SHOULDER_Y = 1.9;
const HUMAN_CAMERA_SHOULDER_Y = 5.6;
const HUMAN_NAMEPLATE_OFFSET_Y = 9.35;
const ACTION_JUICE_MOUSE_OFFSET_Y = 1.14;
const ACTION_JUICE_HUMAN_OFFSET_Y = 5.6;
const MISCHIEF_CHAIN_WINDOW_SECONDS = 3.4;
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

const GITHUB_URL = 'https://github.com/ryanfitzpatrickio/vibejam2026';

/** Cat AI states where the hunt target is the local player — drives ambient crossfade. */
const CAT_AMBIENT_HUNT_AI = new Set(['alert', 'roar', 'chase', 'chase_ball', 'attack', 'cooldown']);

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

  const room = new Room({
    height: 4,
    scale: 1,
    useGeneratedBakes: false,
    useHouseGeneratedBake: false,
  });
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

  const perfFlags = createPerfFlags();
  const qualityState = createQualityState();

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
  const mischiefMeter = new MischiefMeter();
  const onboarding = new OnboardingOverlay();
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
  let _prevExtractProgress = 0;
  let _wasExtracted = false;

  const extractionMarkers = createExtractionPortalMarkers(scene);

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
    getExtraNonOccluders: () => {
      const mountId = predictionState?.mountId || net?.serverState?.mountId;
      const mountObject = dynamicWorldItems?.getMountRenderState?.(mountId)?.object;
      return mountObject ? [mountObject] : [];
    },
  });

  // --- Multiplayer ---
  const portalArrival = readVibePortalArrivalFromSearch(window.location.search);
  const net = offlineMode
    ? createOfflineNetClient(roomId)
    : new NetworkClient(roomId, {
      portalArrival: portalArrival.active ? portalArrival : null,
    });
  function requestSqueak() {
    net.sendSqueak?.();
  }
  controller.onSqueak = requestSqueak;
  const onGhostSqueakPointer = (event) => {
    if (event.button !== 2) return;
    const ss = net.serverState;
    if (!(ss?.spectator || ss?.alive === false || ss?.extracted)) return;
    event.preventDefault();
    requestSqueak();
  };
  const onGhostSqueakContextMenu = (event) => {
    const ss = net.serverState;
    if (!(ss?.spectator || ss?.alive === false || ss?.extracted)) return;
    event.preventDefault();
  };
  canvas.addEventListener('pointerdown', onGhostSqueakPointer);
  canvas.addEventListener('contextmenu', onGhostSqueakContextMenu);
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

  net.on((data) => {
    if (data?.type === 'open') {
      devLayoutSyncedForConnection = false;
      maybeSyncDevLayoutToServer();
      return;
    }
    if (handleHeroUnlockMarkerMessage(room, data)) {
      return;
    }
    if (data?.type === 'task-completed' && typeof data.taskId === 'string') {
      taskController.markTaskCompleted(data.taskId);
      const entry = room?.editableRaidTaskObjects?.get(data.taskId);
      if (entry?.definition && entry.group) {
        const label = data.taskType === 'topple_tower'
          ? 'CRASH!'
          : data.taskType === 'sabotage_roomba'
            ? 'Roomba jammed!'
            : data.taskType === 'knife_drawer'
              ? 'Drawer raided!'
              : data.taskType === 'window'
                ? 'Window opened!'
                : 'Mischief!';
        spawnActionJuice({ position: entry.group.position, isAdversary: false }, label, 'mischief');
      }
    }
  });
  const remotePlayerManager = new RemotePlayerManager({ scene });
  // Per-mesh outlines on remote mice are redundant once the fullscreen outline
  // pass is active; leave the toggle available for comparison.
  remotePlayerManager.setEdgeOutlinesVisible(false);
  if (!offlineMode) net.connect();

  /** Track previous smackStunTimer / grabbedTarget per player for audio event detection. */
  const _prevSmackStun = new Map();
  const _prevChargedSmackHitSeq = new Map();
  const _prevGrabbedTarget = new Map();
  const _prevLimpBounceHitSeq = new Map();
  const _prevBurnSeq = new Map();
  const _burnEffects = new Map();
  let _prevCatAiState = 'idle';

  const _localNameplateWorld = new THREE.Vector3();
  const _physicsInputDir = new THREE.Vector3();
  const _physicsForward = new THREE.Vector3();
  const _physicsRight = new THREE.Vector3();
  const _physicsWorldUp = new THREE.Vector3(0, 1, 0);
  const _physicsJumpSoundPos = new THREE.Vector3();
  const _spatialEventPos = new THREE.Vector3();
  const _burnEffectWorldPos = new THREE.Vector3();
  const _actionJuiceWorldPos = new THREE.Vector3();
  /** Per-player snapshot state used for popup deltas. */
  const _prevActionJuiceState = new Map();
  /** Per-player smack combo window. */
  const _mischiefChains = new Map();
  let occlusionFrameIndex = 0;

  const dynamicWorldItems = createDynamicWorldItems(scene, { room });
  const _mountedRiderOffset = new THREE.Vector3();
  const _mountedRenderPosition = new THREE.Vector3();

  function findMountSnapshot(mountId) {
    if (!mountId || !Array.isArray(net.mounts)) return null;
    return net.mounts.find((mount) => mount?.id === mountId) ?? null;
  }

  function mountSnapshotValue(value, fallback) {
    if (Number.isFinite(value)) return value;
    return Number.isFinite(fallback) ? fallback : 0;
  }

  function applySmoothedMountedRiderVisual() {
    const ss = net.serverState;
    const mountId = predictionState.mountId || ss?.mountId;
    if (!mountId || !ss?.position) return false;

    const mountRender = dynamicWorldItems.getMountRenderState?.(mountId);
    const mountSnapshot = findMountSnapshot(mountId);
    if (!mountRender?.position || !mountSnapshot) return false;

    _mountedRiderOffset.set(
      ss.position.x - mountSnapshotValue(mountSnapshot.x, mountRender.targetPosition?.x),
      ss.position.y - mountSnapshotValue(mountSnapshot.y, mountRender.targetPosition?.y),
      ss.position.z - mountSnapshotValue(mountSnapshot.z, mountRender.targetPosition?.z),
    );
    _mountedRenderPosition.set(
      mountRender.position.x + _mountedRiderOffset.x,
      mountRender.position.y + _mountedRiderOffset.y + mouse.groundOffset,
      mountRender.position.z + _mountedRiderOffset.z,
    );
    mouse.position.copy(_mountedRenderPosition);
    renderPositionSmoother.snapToWorld(_mountedRenderPosition);
    return true;
  }

  const ropeSystem = new RopeSystem({
    resolveTexture: (atlasId, cellIndex) => room._createAtlasTexture(cellIndex, atlasId),
  });
  scene.add(ropeSystem);

  function resize(width, height, pixelRatio = window.devicePixelRatio || 1) {
    const safeWidth = Math.max(1, Math.floor(width));
    const safeHeight = Math.max(1, Math.floor(height));
    qualityState.lastResizeWidth = safeWidth;
    qualityState.lastResizeHeight = safeHeight;
    qualityState.lastDevicePixelRatio = Math.max(1, Number(pixelRatio) || 1);
    // Retina DPR=2 renders 4x the pixels. 1.5 keeps the image crisp enough
    // while cutting GPU fill cost and laptop heat substantially.
    const clampedPixelRatio = Math.min(qualityState.dprCap, qualityState.lastDevicePixelRatio);
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
  const chargedSmackReticle = createHoldActionReticle({
    keyLabel: actionLabel('smack'),
    actionLabel: 'SMACK',
    color: '#ff7a90',
    glow: 'rgba(255,122,144,0.56)',
    position: { x: 0, y: -0.78, z: 0 },
  });
  localNameplateAnchor.add(chargedSmackReticle.label);
  const chargedJumpReticle = createHoldActionReticle({
    keyLabel: actionLabel('jump'),
    actionLabel: 'JUMP',
    color: '#7dd3fc',
    glow: 'rgba(125,211,252,0.56)',
    position: { x: 0, y: -0.98, z: 0 },
  });
  localNameplateAnchor.add(chargedJumpReticle.label);
  const chargedThrowReticle = createHoldActionReticle({
    keyLabel: actionLabel('smack'),
    actionLabel: 'THROW',
    color: '#fde68a',
    glow: 'rgba(253,230,138,0.58)',
    position: { x: 0, y: -1.18, z: 0 },
  });
  localNameplateAnchor.add(chargedThrowReticle.label);
  const chargedThrowTracer = createChargedThrowTracer(scene);
  const extractRing = createExtractHoldRing();
  localNameplateAnchor.add(extractRing.label);
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
    renderMobileToggle: !isCoarsePointer,
    onToggle: () => { controller.adversaryTogglePressed = true; },
  });
  const windStreaks = new WindStreakField({ camera });
  // The camera must be in the scene for its children (the wind streak LineSegments)
  // to render. Three.js skips children of objects not attached to the active scene.
  if (!camera.parent) scene.add(camera);

  const performanceToggles = createPerformanceToggles({
    perfFlags,
    labelRenderer,
    localNameplate,
    remotePlayerManager,
    actionJuice,
    hud,
    roundRaid,
    mischiefMeter,
    catLocator,
    scoreboard,
    toolbar,
    chaseAlert,
    adversaryStatus,
    heroPrompt,
    taskPromptElement,
    mouse,
    getPredictionState: () => predictionState,
    getHuman: () => human,
    getCat: () => cat,
    getRoomba: () => roomba,
    windStreaks,
    ropeSystem,
    room,
    extractionMarkerGroup: extractionMarkers.group,
  });

  let lastReconciledSeq = -2;
  const vibePortalManager = new VibePortalManager({
    scene,
    getPlayerState: () => predictionState,
    getPlayerObject: () => mouse,
    getPlayerColor: () => '#f5a962',
    getPortalPlacements: () => room.getVibePortalPlacements(),
  });

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

  function playerActionJuiceOffsetY(playerState) {
    return playerState?.isAdversary ? ACTION_JUICE_HUMAN_OFFSET_Y : ACTION_JUICE_MOUSE_OFFSET_Y;
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

  const CHARGE_SFX_INTERVAL_MS = 260;
  const CHARGE_SFX_PITCHES = [0.88, 1.04, 1.22, 1.42];

  function resetChargeSfxLoop(loop) {
    loop.nextAt = 0;
    loop.step = 0;
  }

  function updateChargeSfxLoop(loop, active, soundType, position, nowMs) {
    if (!active) {
      resetChargeSfxLoop(loop);
      return;
    }
    if (nowMs < loop.nextAt) return;
    const pitch = CHARGE_SFX_PITCHES[Math.min(loop.step, CHARGE_SFX_PITCHES.length - 1)];
    audioManager.playSoundAtPosition(soundType, position, { playbackRate: pitch });
    loop.step += 1;
    loop.nextAt = nowMs + CHARGE_SFX_INTERVAL_MS;
  }

  // Visual smoothing: render position lerps toward prediction to hide small corrections.
  const renderPositionSmoother = createRenderPositionSmoother();
  const PHYSICS_STEP = 1 / 30;
  const MAX_PHYSICS_STEPS = 4;
  let physicsAccum = 0;
  let previousJumpHeld = false;
  let jumpHoldMs = 0;
  let jumpChargeProgress = 0;
  const jumpChargeSfxLoop = { nextAt: 0, step: 0 };
  const chargedSmackSfxLoop = { nextAt: 0, step: 0 };
  let chargedThrowSfxAt = 0;
  let prevLocalMountId = null;
  let nextBirdIdleChirpAt = 0;
  let localChargedThrowSpinAngle = 0;
  let localChargedThrowWasSpinning = false;
  let ropePoseGraceUntil = 0;
  let localGrabAnimTimer = 0;
  let prevLocalGrabbedTarget = null;
  let prevLocalGrabbedBy = null;
  let prevLocalGrabbedBallId = null;

  function reconcileWithServer() {
    if (net.serverSeq <= lastReconciledSeq) return;
    lastReconciledSeq = net.serverSeq;

    const ss = net.serverState;
    if (!ss) return;

    // Save pre-reconciliation predicted position
    const prevX = predictionState.position.x;
    const prevY = predictionState.position.y;
    const prevZ = predictionState.position.z;

    copyServerToPrediction(predictionState, ss);

    const dt = 1 / 30;
    const colliders = getCollisionCollidersWithRoomba();
    for (const input of net.pendingInputs) {
      if (predictionState.mountId) break;
      const vPull = vacuumPullForPrediction(net, predictionState);
      simulateTick(predictionState, input, dt, CLIENT_BOUNDS, colliders, vPull);
    }

    restoreTinyPredictionCorrection(predictionState, { x: prevX, y: prevY, z: prevZ });
  }

  function snapLocalStateToServer(ss) {
    copyServerToPrediction(predictionState, ss);
    localGrabAnimTimer = 0;
    prevLocalGrabbedTarget = ss?.grabbedTarget ?? null;
    prevLocalGrabbedBy = ss?.grabbedBy ?? null;
    prevLocalGrabbedBallId = ss?.grabbedBallId ?? null;
    mouse.setYaw(predictionState.rotation);
    previousJumpHeld = false;
    jumpHoldMs = 0;
    jumpChargeProgress = 0;
    resetChargeSfxLoop(jumpChargeSfxLoop);
    resetChargeSfxLoop(chargedSmackSfxLoop);
    physicsAccum = 0;
    net.pendingInputs.length = 0;
    renderPositionSmoother.snapToPrediction(predictionState, mouse.groundOffset);
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
      roundRaid.showRoundEnd(data, net.localId);
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

    if (data.type === 'squeak' || data.type === 'ghost-squeak') {
      const pos = data.position ?? {};
      _spatialEventPos.set(
        Number(pos.x) || 0,
        (Number(pos.y) || 0) + 0.45,
        Number(pos.z) || 0,
      );
      audioManager.playSoundAtPosition('squeak', _spatialEventPos);
      spawnActionJuice(
        { position: _spatialEventPos, isAdversary: false },
        data.type === 'ghost-squeak' ? 'ghost squeak' : 'squeak!',
        data.type === 'ghost-squeak' ? 'mischief' : 'grab',
      );
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
    mischiefMeter.setVisible(shown && perfFlags.gameplayUi);
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
    if (!renderPositionSmoother.isInitialized()) return false;
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
        renderPositionSmoother.snapToPrediction(predictionState, mouse.groundOffset);
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
    updateAdaptiveQuality({
      deltaSeconds,
      qualityState,
      perfFlags,
      actionJuice,
      outlinePipeline,
      setLabelsEnabled: performanceToggles.setLabelsEnabled,
      resize,
    });

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

      const localMounted = !!(predictionState.mountId || net.serverState?.mountId);
      const jumpHeld = !!keys[kb.jump];
      const jumpReleased = !jumpHeld && previousJumpHeld;
      const canChargeJump = !localMounted;
      if (jumpHeld && !previousJumpHeld) {
        jumpHoldMs = 0;
        jumpChargeProgress = 0;
        resetChargeSfxLoop(jumpChargeSfxLoop);
      }
      const canGroundedChargedJump = predictionState.grounded
        || (Number(predictionState.groundedGraceTimer) || 0) > 0;
      updateChargeSfxLoop(
        jumpChargeSfxLoop,
        !!(
          jumpHeld
          && canChargeJump
          && jumpHoldMs >= CHARGED_JUMP_MIN_HOLD_MS
          && (canGroundedChargedJump || jumpChargeSfxLoop.step > 0)
          && predictionState.alive !== false
          && !predictionState.extracted
          && !predictionState.spectator
        ),
        'jumpcharge',
        predictionState.position,
        timeMs,
      );
      let jumpPressed = false;
      let jumpCharge = 0;
      if (jumpHeld && canChargeJump) {
        jumpHoldMs += PHYSICS_STEP * 1000;
        jumpChargeProgress = Math.max(0, Math.min(
          1,
          (jumpHoldMs - CHARGED_JUMP_MIN_HOLD_MS) / (CHARGED_JUMP_FULL_HOLD_MS - CHARGED_JUMP_MIN_HOLD_MS),
        ));
      } else if (!canChargeJump) {
        jumpHoldMs = 0;
        jumpChargeProgress = 0;
        resetChargeSfxLoop(jumpChargeSfxLoop);
      }
      if (jumpReleased) {
        jumpPressed = true;
        jumpCharge = canChargeJump && jumpHoldMs >= CHARGED_JUMP_MIN_HOLD_MS ? jumpChargeProgress : 0;
        jumpHoldMs = 0;
        jumpChargeProgress = 0;
        resetChargeSfxLoop(jumpChargeSfxLoop);
      }
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
        jumpCharge,
        crouch: !!keys[kb.crouch] || !!keys.ControlLeft || !!keys.ControlRight || !!keys.Control,
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
      const vPull = vacuumPullForPrediction(net, predictionState);
      const jumpSoundAllowed = jumpPressed
        && predictionState.alive
        && !predictionState.isAdversary
        && !localMounted
        && (
          predictionState.grounded
          || (Number(predictionState.groundedGraceTimer) || 0) > 0
          || predictionState.wallHolding
          || (predictionState.canDoubleJump && !predictionState.hasDoubleJumped)
        );
      if (jumpSoundAllowed) {
        _physicsJumpSoundPos.set(
          predictionState.position.x,
          predictionState.position.y + mouse.groundOffset,
          predictionState.position.z,
        );
        audioManager.playSoundAtPosition(jumpCharge >= 0.45 ? 'bigjump' : 'jump', _physicsJumpSoundPos);
      }
      if (localMounted && net.serverState) {
        copyServerToPrediction(predictionState, net.serverState);
        predictionState.animState = 'sit';
      } else {
        simulateTick(predictionState, input, PHYSICS_STEP, CLIENT_BOUNDS, colliders, vPull);
      }

      const renderPos = renderPositionSmoother.updateFromPrediction(
        predictionState,
        mouse.groundOffset,
        PHYSICS_STEP,
      );

      mouse.position.x = renderPos.x;
      mouse.position.y = renderPos.y;
      mouse.position.z = renderPos.z;
      if (localMounted) {
        applySmoothedMountedRiderVisual();
      }

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
      controller.chargedJumpHeld = canChargeJump && jumpHoldMs >= CHARGED_JUMP_MIN_HOLD_MS && (
        predictionState.grounded
        || (Number(predictionState.groundedGraceTimer) || 0) > 0
      );
      controller.jumpChargeProgress = canChargeJump ? jumpChargeProgress : 0;
      controller.forcedAnimationState = predictionState.extracted ? 'win' : (localMounted ? 'sit' : null);
      if (controller.forcedAnimationState) {
        emoteManager.cancel();
      }
      const localGrabbedTarget = net.serverState?.grabbedTarget ?? null;
      const localGrabbedBy = net.serverState?.grabbedBy ?? null;
      const localGrabbedBallId = net.serverState?.grabbedBallId ?? null;
      const localHeldTarget = !!(localGrabbedTarget || localGrabbedBallId);
      controller.throwOnInteractWhileGrabHeld = localHeldTarget;
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
      const cameraArm = cameraHumanMode ? HUMAN_CAMERA_ARM_LENGTH : (localMounted ? MOUNT_CAMERA_ARM_LENGTH : MOUSE_CAMERA_ARM_LENGTH);
      const cameraShoulderY = cameraHumanMode ? HUMAN_CAMERA_SHOULDER_Y : (localMounted ? MOUNT_CAMERA_SHOULDER_Y : MOUSE_CAMERA_SHOULDER_Y);
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
      const localHeldForChargedThrow = !!(net.serverState?.grabbedTarget || net.serverState?.grabbedBallId);
      const localChargingSmackForSfx = !!(
        controller.smackHeld
        && controller.smackHoldMs >= CHARGED_SMACK_INDICATOR_HOLD_MS
        && !localHeldForChargedThrow
        && predictionState.alive !== false
        && !predictionState.extracted
        && !predictionState.spectator
      );
      updateChargeSfxLoop(
        chargedSmackSfxLoop,
        localChargingSmackForSfx,
        'chargehit',
        predictionState.position,
        timeMs,
      );
      emoteManager.update(PHYSICS_STEP);

      if (net.connected) {
        const inputWithEmote = { ...input };
        const localChargingThrow = localHeldForChargedThrow
          && (controller.chargedThrowHeld || controller.chargedThrowReleasePressed);
        const localQuickTossActive = !!(controller.quickTossHeld || controller.quickTossReleasePressed);
        const localSpinningThrow = localChargingThrow || (localHeldForChargedThrow && localQuickTossActive);
        if (localSpinningThrow) {
          const aim = getChargedThrowAimDirection(thirdPersonCamera, chargedThrowTracer.aimDir);
          const serverAngle = Number(net.serverState?._chargedThrowOrbitAngle);
          if (!localChargedThrowWasSpinning) {
            localChargedThrowSpinAngle = Number.isFinite(serverAngle) ? serverAngle : mouse.getYaw();
          }
          localChargedThrowWasSpinning = true;
          localChargedThrowSpinAngle += LOCAL_CHARGED_THROW_ORBIT_SPEED * PHYSICS_STEP;
          const spinYaw = Math.atan2(Math.sin(localChargedThrowSpinAngle), Math.cos(localChargedThrowSpinAngle));
          mouse.setYaw(spinYaw);
          predictionState.rotation = spinYaw;
          inputWithEmote.rotation = spinYaw;
          if (localChargingThrow) {
            inputWithEmote.chargedThrowAimX = aim.x;
            inputWithEmote.chargedThrowAimZ = aim.z;
          }
          if (localQuickTossActive) {
            inputWithEmote.quickTossAimX = aim.x;
            inputWithEmote.quickTossAimZ = aim.z;
          }
        } else {
          localChargedThrowWasSpinning = false;
        }
        if (localQuickTossActive && !localSpinningThrow) {
          const aim = getChargedThrowAimDirection(thirdPersonCamera, chargedThrowTracer.aimDir);
          inputWithEmote.quickTossAimX = aim.x;
          inputWithEmote.quickTossAimZ = aim.z;
        }
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
        inputWithEmote.smackHeld = !!controller.smackHeld;
        if (controller.chargedSmackReleasePressed) {
          inputWithEmote.chargedSmackRelease = true;
          controller.chargedSmackReleasePressed = false;
          _smackFiredThisFrame = true;
        }
        if (controller.throwPressed) {
          inputWithEmote.throw = true;
          controller.throwPressed = false;
        }
        inputWithEmote.chargedThrowHeld = !!controller.chargedThrowHeld;
        if (controller.chargedThrowReleasePressed) {
          inputWithEmote.chargedThrowRelease = true;
          controller.chargedThrowReleasePressed = false;
        }
        inputWithEmote.quickTossHeld = !!controller.quickTossHeld;
        if (controller.quickTossReleasePressed) {
          inputWithEmote.quickTossRelease = true;
          controller.quickTossReleasePressed = false;
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

    const frameKeys = controller.keys;
    const frameKb = controller.keyBindings;
    const frameCameraHumanMode = !!predictionState.isAdversary;
    const frameLocalMounted = !!(predictionState.mountId || net.serverState?.mountId);
    const frameLocalHeldTarget = !!(net.serverState?.grabbedTarget || net.serverState?.grabbedBallId);
    const throwAimCameraActive = !!(
      !frameCameraHumanMode
      && frameLocalHeldTarget
      && (frameKeys[frameKb.interact] || controller.chargedThrowHeld || controller.quickTossHeld)
      && predictionState.alive !== false
      && !predictionState.extracted
      && !predictionState.spectator
    );
    const frameCameraArm = frameCameraHumanMode ? HUMAN_CAMERA_ARM_LENGTH : (frameLocalMounted ? MOUNT_CAMERA_ARM_LENGTH : MOUSE_CAMERA_ARM_LENGTH);
    const frameCameraShoulderY = frameCameraHumanMode ? HUMAN_CAMERA_SHOULDER_Y : (frameLocalMounted ? MOUNT_CAMERA_SHOULDER_Y : MOUSE_CAMERA_SHOULDER_Y);
    thirdPersonCamera.setArmLength(dampValue(thirdPersonCamera.armLength, frameCameraArm, 7, deltaSeconds));
    thirdPersonCamera.sideOffset = dampValue(
      thirdPersonCamera.sideOffset ?? 0,
      throwAimCameraActive ? CHARGED_THROW_CAMERA_SIDE_OFFSET : 0,
      14,
      deltaSeconds,
    );
    thirdPersonCamera.shoulderOffset.y = dampValue(
      thirdPersonCamera.shoulderOffset.y,
      frameCameraShoulderY,
      9,
      deltaSeconds,
    );
    thirdPersonCamera.update(deltaSeconds, mouse.position);

    if (perfFlags.predators) predatorManager?.update(deltaSeconds);

    if (cat && perfFlags.predators && net.connected) {
      const serverCat = net.remotePredators.get('cat-0');
      if (serverCat) {
        cat.applyServerState(serverCat);
        // Play cat sound on attack/roar transitions
        const catAi = serverCat.ai ?? 'idle';
        if (catAi === 'stunned' && _prevCatAiState !== 'stunned') {
          audioManager.playSoundAtPosition('catstun', new THREE.Vector3(
            serverCat.px ?? 0, (serverCat.py ?? 0) + 0.5, serverCat.pz ?? 0,
          ));
        }
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
    room.applyFanRuntimeStates(net.connected ? net.fans : null);
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
      syncActionJuicePopups({
        allPlayers,
        nowSeconds,
        previousState: _prevActionJuiceState,
        mischiefChains: _mischiefChains,
        chainWindowSeconds: MISCHIEF_CHAIN_WINDOW_SECONDS,
        spawnActionJuice,
      });
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

        const chargedHitSeq = Number(pState.chargedSmackHitSeq) || 0;
        const prevChargedHitSeq = _prevChargedSmackHitSeq.get(pid) ?? 0;
        if (chargedHitSeq > prevChargedHitSeq && pState.position) {
          _spatialEventPos.set(pState.position.x, pState.position.y + 0.5, pState.position.z);
          audioManager.playSoundAtPosition('bighit', _spatialEventPos);
        }
        _prevChargedSmackHitSeq.set(pid, chargedHitSeq);

        const prevGrab = _prevGrabbedTarget.get(pid) ?? null;
        const curGrab = pState.grabbedTarget ?? null;
        if (curGrab && !prevGrab) {
          // Just initiated a grab — play grab sound at their position
          _spatialEventPos.set(pState.position.x, pState.position.y + 0.5, pState.position.z);
          audioManager.playSoundAtPosition('grab', _spatialEventPos);
        }
        _prevGrabbedTarget.set(pid, curGrab);

        const bounceSeq = Number(pState.limpBounceHitSeq) || 0;
        const prevBounceSeq = _prevLimpBounceHitSeq.get(pid) ?? 0;
        if (bounceSeq > prevBounceSeq && pState.position) {
          _spatialEventPos.set(pState.position.x, pState.position.y + 0.4, pState.position.z);
          audioManager.playSoundAtPosition('bouncehit', _spatialEventPos);
        }
        _prevLimpBounceHitSeq.set(pid, bounceSeq);

        const burnSeq = Number(pState.burnEffectSeq) || 0;
        const prevBurnSeq = _prevBurnSeq.get(pid) ?? 0;
        const burning = (Number(pState.burnTimer) || 0) > 0;
        const pos = pState.position;
        if (pos) {
          _burnEffectWorldPos.set(pos.x, pos.y + 0.22, pos.z);
          let burnEffect = _burnEffects.get(pid);
          if (burnSeq > prevBurnSeq) {
            burnEffect?.dispose();
            burnEffect = new BurnEffect(scene, _burnEffectWorldPos);
            _burnEffects.set(pid, burnEffect);
            audioManager.playSoundAtPosition('crash', _burnEffectWorldPos);
            spawnActionJuice({ position: _burnEffectWorldPos, isAdversary: false }, 'HOT!', 'smack');
          }
          if (burnEffect) {
            burnEffect.setPosition(_burnEffectWorldPos);
            burnEffect.setActive(burning);
            burnEffect.update(deltaSeconds);
            if (burnEffect.finished) {
              burnEffect.dispose();
              _burnEffects.delete(pid);
            }
          }
        }
        _prevBurnSeq.set(pid, burnSeq);
      }
      // Clean up stale entries
      for (const pid of _prevSmackStun.keys()) {
        if (!allPlayers.has(pid)) {
          _prevSmackStun.delete(pid);
          _prevGrabbedTarget.delete(pid);
          _prevBurnSeq.delete(pid);
          _burnEffects.get(pid)?.dispose();
          _burnEffects.delete(pid);
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
    const cheeseForHud = net.connected
      ? (net.serverState?.cheeseCarried ?? 0)
      : Math.max(0, Math.floor(predictionState.cheeseCarried ?? 0));
    const livesForHud = net.connected
      ? (net.serverState?.livesRemaining ?? 2)
      : (predictionState.livesRemaining ?? 2);

    hud.update({
      stamina: controller.staminaPercent,
      health: controller.healthPercent,
      ping: net.ping,
      playerCount,
      connectedCount,
      botCount,
      cheese: cheeseForHud,
      lives: livesForHud,
      heroAvatar: net.connected
        ? (net.serverState?.heroAvatar ?? null)
        : (predictionState.heroAvatar ?? null),
      heroAvailable: net.connected
        ? !!(perfFlags.gameplayUi && net.serverState?.heroAvailable && !net.serverState?.isHero && isAlive)
        : !!(perfFlags.gameplayUi && predictionState.heroAvailable && isAlive),
      heroAvatarAvailable: net.connected
        ? (net.serverState?.heroAvatarAvailable ?? null)
        : (predictionState.heroAvatarAvailable ?? null),
      heroTimeRemaining: net.connected
        ? (net.serverState?.heroTimeRemaining ?? 0)
        : (predictionState.heroTimeRemaining ?? 0),
      alive: isAlive,
      respawnCountdown,
      mischiefScore: Math.max(0, Math.floor(Number(
        (net.connected ? net.serverState : predictionState)?.roundStats?.mischiefScore,
      ) || 0)),
    });

    roundRaid.updateTopBarStats({
      lives: livesForHud,
      maxLives: 2,
      cheese: cheeseForHud,
      cheeseMax: 50,
      connectedCount,
      botCount,
    });

    heroPrompt.setVisible(false);
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
    mobileControls?.setHumanSwitchState?.(humanRolePatch);

    roundRaid.updatePhaseBanner(net.connected ? net.round : null, Date.now() / 1000, {
      subtitle: '',
    });
    mischiefMeter.update(net.connected ? net.serverState : predictionState, Date.now() / 1000);

    const currentPhase = net.connected ? (net.round?.phase ?? null) : null;
    if (currentPhase !== _prevRoundPhase) {
      if (currentPhase === 'extract' && _prevRoundPhase !== null) {
        roundRaid.showExtractAlert('EXIT OPEN!');
        audioManager.playExtractCountdown?.();
        audioManager.playSoundAtPosition('crash', predictionState.position);
      }
      if (currentPhase === 'intermission') {
        audioManager.startIntermissionMusic?.();
      } else if (_prevRoundPhase === 'intermission') {
        audioManager.stopIntermissionMusic?.();
      }
      _prevRoundPhase = currentPhase;
    }

    const extractProgress = Math.max(0, Math.min(1, Number(net.serverState?.extractProgress) || 0));
    if (
      net.connected
      && net.round?.phase === 'extract'
      && !_wasExtracted
      && !!net.serverState?.extracted
    ) {
      spawnActionJuice(net.serverState, 'Escaped!', 'mischief');
      audioManager.playSoundAtPosition('pickup', predictionState.position);
    }
    if (
      net.connected
      && net.round?.phase === 'extract'
      && _prevExtractProgress > 0.18
      && extractProgress < _prevExtractProgress - 0.08
      && !net.serverState?.extracted
    ) {
      spawnActionJuice(net.serverState, 'Interrupted!', 'smack');
      audioManager.playSoundAtPosition('beep', predictionState.position);
    }
    _prevExtractProgress = extractProgress;
    _wasExtracted = !!net.serverState?.extracted;

    updateExtractHoldRing(extractRing, false, extractProgress);

    const showChargedSmackReticle = !!(
      perfFlags.gameplayUi
      && controller.smackHeld
      && !(net.serverState?.grabbedTarget || net.serverState?.grabbedBallId)
      && controller.smackHoldMs >= CHARGED_SMACK_INDICATOR_HOLD_MS
      && predictionState.alive !== false
      && !predictionState.extracted
      && !predictionState.spectator
    );
    chargedSmackReticle.update({
      visible: showChargedSmackReticle,
      progress: controller.smackChargeProgress,
      keyLabel: actionLabel('smack'),
      actionLabel: 'SMACK',
    });
    const showChargedJumpReticle = !!(
      perfFlags.gameplayUi
      && jumpHoldMs >= CHARGED_JUMP_INDICATOR_HOLD_MS
      && (
        predictionState.grounded
        || (Number(predictionState.groundedGraceTimer) || 0) > 0
      )
      && predictionState.alive !== false
      && !predictionState.extracted
      && !predictionState.spectator
    );
    chargedJumpReticle.update({
      visible: showChargedJumpReticle,
      progress: jumpChargeProgress,
      keyLabel: actionLabel('jump'),
      actionLabel: 'JUMP',
    });
    const localHeldForThrowHud = !!(net.serverState?.grabbedTarget || net.serverState?.grabbedBallId);
    const throwHudIsQuickToss = !!(controller.quickTossHeld && !controller.chargedThrowHeld);
    const showChargedThrowReticle = !!(
      perfFlags.gameplayUi
      && localHeldForThrowHud
      && (controller.chargedThrowHeld || controller.quickTossHeld)
      && (
        controller.chargedThrowHeld
          ? controller.chargedThrowHoldMs >= CHARGED_THROW_INDICATOR_HOLD_MS
          : controller.quickTossHoldMs >= QUICK_TOSS_INDICATOR_HOLD_MS
      )
      && predictionState.alive !== false
      && !predictionState.extracted
      && !predictionState.spectator
    );
    chargedThrowReticle.update({
      visible: showChargedThrowReticle,
      progress: throwHudIsQuickToss ? controller.quickTossProgress : controller.chargedThrowProgress,
      keyLabel: throwHudIsQuickToss ? 'LMB' : actionLabel('smack'),
      actionLabel: throwHudIsQuickToss ? 'TOSS' : 'THROW',
    });
    const showChargedThrowTracer = !!(
      perfFlags.gameplayUi
      && localHeldForThrowHud
      && (controller.chargedThrowHeld || controller.quickTossHeld)
      && predictionState.alive !== false
      && !predictionState.extracted
      && !predictionState.spectator
    );
    updateChargedThrowTracer(chargedThrowTracer, {
      visible: showChargedThrowTracer,
      thirdPersonCamera,
      predictionState,
      groundOffset: mouse.groundOffset,
    });
    if (showChargedThrowReticle && timeMs >= chargedThrowSfxAt) {
      audioManager.playSoundAtPosition('spin', predictionState.position);
      chargedThrowSfxAt = timeMs + 420;
    } else if (!showChargedThrowReticle) {
      chargedThrowSfxAt = 0;
    }

    const hasExtractionMarkers = extractionMarkers.update({
      portals: net.connected ? net.extractionPortals : [],
      visible: perfFlags.raidMarkers,
      nowSeconds,
    });
    if (!hasExtractionMarkers) {
      hideExtractHoldRing(extractRing);
    }
    if (nowSeconds - qualityState.lastScoreboardAt >= 0.2) {
      qualityState.lastScoreboardAt = nowSeconds;
      const scoreboardRows = buildScoreboardRows(net, predictionState);
      scoreboard.setRows(scoreboardRows);
      toolbar.setLeaderboardRows(scoreboardRows);
    }

    const chaseStreak = net.connected
      ? (net.serverState?.chaseStreakSeconds ?? 0)
      : 0;
    chaseAlert.update({
      active: !!(controller.alive && chaseStreak > 0.02),
      streakSeconds: chaseStreak,
    });

    if (perfFlags.gameplayUi && cat && ENABLE_CAT_PREDATOR && nowSeconds - qualityState.lastCatLocatorAt >= 0.1) {
      qualityState.lastCatLocatorAt = nowSeconds;
      catLocator.update({
        camera,
        canvasRect: canvas.getBoundingClientRect(),
        catWorldPos: cat.position,
        catAlive: !!cat.alive,
      });
    } else if (!perfFlags.gameplayUi || !cat || !ENABLE_CAT_PREDATOR) {
      catLocator.update({});
    }

    const balls = net.pushBalls;
    const ropeDistanceSq = nearestRopeDistanceSq(net.ropes, predictionState.position);
    const ropeGrabAssistActive = !!(
      controller.ropeGrabHeld
      && !predictionState.grounded
      && ropeDistanceSq <= ROPE_HINT_RANGE * ROPE_HINT_RANGE
    );
    const ropePoseSignal = !!(net.serverState?.ropeSwing || predictionState.ropeSwing || ropeGrabAssistActive);
    if (ropePoseSignal) ropePoseGraceUntil = nowSeconds + ROPE_POSE_GRACE_SECONDS;
    const ropePoseActive = ropePoseSignal || nowSeconds < ropePoseGraceUntil;
    dynamicWorldItems.updatePushBalls({
      connected: net.connected,
      balls,
    });
    dynamicWorldItems.updateMounts({
      connected: net.connected,
      mounts: net.mounts,
      deltaSeconds,
    });
    applySmoothedMountedRiderVisual();
    const localMountId = net.serverState?.mountId ?? predictionState.mountId ?? null;
    if (localMountId && localMountId !== prevLocalMountId) {
      const mount = findMountSnapshot(localMountId);
      if (mount) {
        audioManager.playSoundAtPosition('birdhappy', {
          x: mount.x ?? predictionState.position.x,
          y: (mount.y ?? predictionState.position.y) + 0.45,
          z: mount.z ?? predictionState.position.z,
        });
      }
      nextBirdIdleChirpAt = nowSeconds + 4.5;
    } else if (!localMountId) {
      nextBirdIdleChirpAt = 0;
    } else if (nowSeconds >= nextBirdIdleChirpAt) {
      const mount = findMountSnapshot(localMountId);
      if (mount && (mount.animState === 'idle' || mount.animState === 'glide')) {
        audioManager.playSoundAtPosition('birdidle', {
          x: mount.x ?? predictionState.position.x,
          y: (mount.y ?? predictionState.position.y) + 0.45,
          z: mount.z ?? predictionState.position.z,
        });
        nextBirdIdleChirpAt = nowSeconds + 5.5 + Math.random() * 2.5;
      } else {
        nextBirdIdleChirpAt = nowSeconds + 1.5;
      }
    }
    prevLocalMountId = localMountId;

    // Context-aware hints for held objects, ropes, and ball handling.
    const hintResult = buildGameplayHint({
      isCoarsePointer,
      controller,
      net,
      ropePoseActive,
      ropeDistanceSq,
      balls,
      mousePosition: mouse.position,
      nowMs: Date.now(),
      smackBallHintCooldownUntil,
      smackBallHintCooldownMs: SMACK_BALL_HINT_COOLDOWN_MS,
      smackFiredThisFrame: _smackFiredThisFrame,
    });
    const nextHint = hintResult.hint;
    smackBallHintCooldownUntil = hintResult.smackBallHintCooldownUntil;
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
        return [n.id, {
          segmentRadius: n.segmentRadius,
          color: n.color,
          texture: n.texture,
          visualMode: n.visualMode,
          cards: n.cards,
        }];
      }),
    );
    if (perfFlags.ropes) {
      ropeSystem.update(net.connected ? net.ropes : [], ropeStyleById);
    } else {
      ropeSystem.update([], ropeStyleById);
    }

    dynamicWorldItems.updateCheesePickups({
      connected: net.connected,
      cheesePickups: net.cheesePickups,
      nowSeconds,
      deltaSeconds,
    });

    occlusionFader.update(deltaSeconds);
    if (nowSeconds - qualityState.lastTaskUpdateAt >= 0.08) {
      qualityState.lastTaskUpdateAt = nowSeconds;
      taskController.update(Math.min(0.16, deltaSeconds + 0.08));
    } else {
      taskController.cheeseBurst?.update?.(deltaSeconds);
    }
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
      if ((occlusionFrameIndex % 3) === 0) {
        localNameplate.setOccluded(
          isNameplateOccluded(scene, camera, _localNameplateWorld, localNameplateTarget, occlusionFrameIndex),
        );
      }
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

    qualityState.actionJuiceAccum += deltaSeconds;
    const actionJuiceStep = qualityState.tier >= 2 ? 1 / 24 : 1 / 45;
    if (qualityState.actionJuiceAccum >= actionJuiceStep) {
      actionJuice.update(Math.min(0.12, qualityState.actionJuiceAccum));
      qualityState.actionJuiceAccum = 0;
    }
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
    canvas.removeEventListener('pointerdown', onGhostSqueakPointer);
    canvas.removeEventListener('contextmenu', onGhostSqueakContextMenu);
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
    dynamicWorldItems.dispose();
    extractionMarkers.dispose();
    roundRaid.dispose();
    mischiefMeter.dispose();
    onboarding.dispose();
    hud.dispose();
    catLocator.dispose();
    audioManager.stopAmbientBed();
    audioManager.stopMovementLoop();
    chargedSmackReticle.dispose();
    chargedJumpReticle.dispose();
    chargedThrowReticle.dispose();
    disposeChargedThrowTracer(scene, chargedThrowTracer);
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
    bindPerformancePanelToggles(panel, {
      renderer,
      room,
      outlinePipeline,
      roomOutlineMeshes,
      localMouseOutlineMeshes,
      remotePlayerManager,
      setOutlineListVisible,
      perfFlags,
      setLabelsEnabled: performanceToggles.setLabelsEnabled,
      setGameplayUiEnabled: performanceToggles.setGameplayUiEnabled,
      setLocalPlayerVisible: performanceToggles.setLocalPlayerVisible,
      setRemotePlayersVisible: performanceToggles.setRemotePlayersVisible,
      setPredatorsVisible: performanceToggles.setPredatorsVisible,
      navMeshOverlay,
      vibePortalManager,
      cheesePickupGroup: dynamicWorldItems.cheesePickupGroup,
      getPushBallsVisible: dynamicWorldItems.getPushBallsVisible,
      setPushBallsVisible: dynamicWorldItems.setPushBallsVisible,
      setWindVisible: performanceToggles.setWindVisible,
      setRopesVisible: performanceToggles.setRopesVisible,
      setRaidMarkersVisible: performanceToggles.setRaidMarkersVisible,
      occlusionFader,
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

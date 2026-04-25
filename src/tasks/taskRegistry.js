import { RAID_TASK_COMPLETE_EFFECTS, RAID_TASK_TYPES } from '../../shared/raidLayout.js';
import { UNLOCK_HERO_DEFS } from '../../shared/heroUnlocks.js';
import { openChewWiresTask } from './ChewWiresTask.jsx';
import { openHeroUnlockTask } from './HeroUnlockTask.jsx';
import {
  openToppleTowerTask,
  openFridgeRaidTask,
  openCutLightsTask,
  openKnifeDrawerTask,
  openSabotageRoombaTask,
  openWindowTask,
} from './KitchenMischiefTasks.jsx';

/**
 * Map a raid-task type to a runtime handler that opens a minigame dialog.
 * Keep each task modular: register a new one by adding a type in raidLayout.js
 * and an entry here. Handlers receive { onComplete, onCancel } and return
 * `{ close() }` so callers can force-close on disconnect/cancel.
 */
export const TASK_RUNTIMES = Object.freeze({
  [RAID_TASK_TYPES.CHEW_WIRES]: {
    id: RAID_TASK_TYPES.CHEW_WIRES,
    label: 'Chew Wires',
    promptVerb: 'chew wires',
    rewardAmount: 8,
    open: openChewWiresTask,
    completeEffect: RAID_TASK_COMPLETE_EFFECTS.SMOKE_SPARKS,
  },
  [RAID_TASK_TYPES.TOPPLE_TOWER]: {
    id: RAID_TASK_TYPES.TOPPLE_TOWER,
    label: 'Topple Tower',
    promptVerb: 'topple the tower',
    rewardAmount: 16,
    open: openToppleTowerTask,
    completeEffect: RAID_TASK_COMPLETE_EFFECTS.SMOKE_SPARKS,
  },
  [RAID_TASK_TYPES.FRIDGE_RAID]: {
    id: RAID_TASK_TYPES.FRIDGE_RAID,
    label: 'Fridge Raid',
    promptVerb: 'raid the fridge',
    rewardAmount: 22,
    open: openFridgeRaidTask,
    completeEffect: RAID_TASK_COMPLETE_EFFECTS.SMOKE_SPARKS,
  },
  [RAID_TASK_TYPES.CUT_LIGHTS]: {
    id: RAID_TASK_TYPES.CUT_LIGHTS,
    label: 'Cut Lights',
    promptVerb: 'cut the lights',
    rewardAmount: 10,
    open: openCutLightsTask,
    completeEffect: RAID_TASK_COMPLETE_EFFECTS.SMOKE_SPARKS,
  },
  [RAID_TASK_TYPES.KNIFE_DRAWER]: {
    id: RAID_TASK_TYPES.KNIFE_DRAWER,
    label: 'Knife Drawer',
    promptVerb: 'raid the knife drawer',
    rewardAmount: 18,
    open: openKnifeDrawerTask,
    completeEffect: RAID_TASK_COMPLETE_EFFECTS.SMOKE_SPARKS,
  },
  [RAID_TASK_TYPES.SABOTAGE_ROOMBA]: {
    id: RAID_TASK_TYPES.SABOTAGE_ROOMBA,
    label: 'Sabotage Roomba',
    promptVerb: 'sabotage the roomba',
    rewardAmount: 12,
    open: openSabotageRoombaTask,
    completeEffect: RAID_TASK_COMPLETE_EFFECTS.SMOKE_SPARKS,
  },
  [RAID_TASK_TYPES.WINDOW]: {
    id: RAID_TASK_TYPES.WINDOW,
    label: 'Window',
    promptVerb: 'open the window',
    rewardAmount: 14,
    open: openWindowTask,
    completeEffect: RAID_TASK_COMPLETE_EFFECTS.NONE,
  },
  [RAID_TASK_TYPES.UNLOCK_GUS]: {
    id: RAID_TASK_TYPES.UNLOCK_GUS,
    label: 'Unlock Gus',
    promptVerb: `give 3 ${UNLOCK_HERO_DEFS.gus.itemShortPlural} to ${UNLOCK_HERO_DEFS.gus.label}`,
    rewardAmount: 0,
    unlockHeroKey: 'gus',
    open: openHeroUnlockTask('gus'),
  },
  [RAID_TASK_TYPES.UNLOCK_SPEEDY]: {
    id: RAID_TASK_TYPES.UNLOCK_SPEEDY,
    label: 'Unlock Speedy',
    promptVerb: `give 3 ${UNLOCK_HERO_DEFS.speedy.itemShortPlural} to ${UNLOCK_HERO_DEFS.speedy.label}`,
    rewardAmount: 0,
    unlockHeroKey: 'speedy',
    open: openHeroUnlockTask('speedy'),
  },
});

export function getTaskRuntime(taskType) {
  return TASK_RUNTIMES[taskType] ?? null;
}

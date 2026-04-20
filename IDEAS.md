# Mouse Trouble: Feature Scaling & Roadmap

This document outlines ideas for scaling existing systems and branching into new, adjacent features. The goal is to maximize player engagement through "high-signal" visual and gameplay improvements while maintaining technical simplicity.

---

## 🚀 High-Value Quick Hits (Implementation Simplicity)

### 1. Mischief Feedback Loop
*   **Visual Juice:** Add floating text/emojis (e.g., `+10 🧀`, `Smacked!`, `Mischief x2`) when players perform actions.
*   **Audio Ramping:** Increase the pitch of the "mischief" sound effect for consecutive actions (combos).
*   **Screen Shake:** Subtle camera shake when the cat roars or when large physics objects (like the roomba) collide.

### 2. Extraction Variety
*   **Dynamic Portals:** Instead of just static holes, add contextual extraction points:
    *   *The Drainpipe:* A vertical extraction that requires a jump.
    *   *The Catapult:* A kitchen spoon on a sponge that "launches" you to the exit.
    *   *The Ventilation Shaft:* A hidden path that opens only during the `extract` phase.
*   **Visual Telegrafing:** Add a "panic" music layer and glowing floor trails leading to exits when the `extract` phase starts.

### 3. Interactive Tasks (Mini-Games)
*   **Chew Wires:** A simple rhythm-based or mash-button task at specific "Task Markers" (already supported in `raidLayout.js`).
*   **Topple the Tower:** Stacks of boxes or cans that award "Mischief Points" when knocked over using the `smack` (E) ability.
*   **The Fridge Raid:** A task that requires two mice to "heave" a door open to reveal high-value loot.

### 4. HUD & Scoreboard Polish
*   **Post-Round Breakdown:** A "Mischievery Grade" (A+ to F) screen showing stats: Cheese stolen, Mice smacked, Seconds chased, and XP earned.
*   **Spectator Mode:** When a mouse dies, allow them to spectate remaining players or the cat with "Ghost Squeaks" (visual-only pings).

---

## 🏔️ Long-Term Goals (Strategic Depth)

### 1. Verticality & Platforming
*   **Climbable Surfaces:** Use "climbable" tags on meshes (curtains, tablecloths) to allow mice to scale vertical surfaces.
*   **Ziplines/Ropes:** Utilize the existing `RopeSystem.js` to create "mouse-highways" across the kitchen.
*   **The "High Ground":** Rewards for reaching the top of the fridge or cabinets (e.g., rare "Golden Cheese").

### 2. Environmental Hazards & Dynamics
*   **Water Spills:** Slippery surfaces that reduce traction and increase slide distance.
*   **Hot Zones:** The stove or toaster acting as periodic hazards that mice must timing-dodge.
*   **Dynamic Lighting:** A "Broom Sweep" event where the kitchen lights turn on, making it easier for the cat to spot mice (reducing its "frustration" threshold).

### 3. Meta-Progression & Customization
*   **The Nest (Lobby):** A persistent 3D lobby where players can see their unlocked trophies and customizations.
*   **Cosmetic Unlocks:** Use XP/Cheese to buy hats (bottle caps, thimbles), fur patterns, or "Squeak" sound packs.
*   **Hero Specialization:** Formalize the "Hero" roles (Speedy Jerry, Tanky Brain) with unique cooldown-based perks (e.g., a short dash or a shield).

### 4. Team Play (Squad Raids)
*   **Shared Loot:** A "Backpack" system where one mouse can carry items while another defends/distracts the cat.
*   **Team Emotes:** Synced emotes that provide small buffs or distractions.
*   **Revive Mechanic:** Allow mice to "lick" a downed teammate back to life before the cat pounces.

---

## 🛠️ Adjacent Technical Branches
*   **Procedural Prefabs:** Randomize the placement of "clutter" objects (cups, plates) each round to keep the kitchen feeling fresh.
*   **AI Evolution:** Give the cat a "hearing" radius that reacts to mouse squeaks or loud physics crashes.
*   **Mobile Refinement:** Haptic feedback for "smacks" and "cat chases" on supported mobile devices.

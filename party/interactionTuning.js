export const GRAB_RANGE = 1.5;
export const GRAB_COOLDOWN = 1.0;
export const GRAB_INITIATOR_ADVANTAGE = 0.65;
export const GRAB_RETRY_INTERVAL_SECONDS = 0.18;

export const SMACK_RANGE = 2.0;
export const SMACK_COOLDOWN = 1.5;
export const SMACK_STUN_DURATION = 1.0;
export const SMACK_KNOCKBACK = 8.0;
export const SMACK_LIMP_THROW_WINDOW_SECONDS = 6.0;
export const LIMP_THROW_BOUNCE_SECONDS = 6.0;

export const CHARGED_SMACK_MIN_HOLD_SECONDS = 1.0;
export const CHARGED_SMACK_MAX_HOLD_SECONDS = 1.6;
export const CHARGED_SMACK_RANGE = 2.45;
export const CHARGED_SMACK_CAT_RANGE = 3.15;
export const CHARGED_SMACK_CAT_STUN_SECONDS = 3.0;
export const CHARGED_SMACK_CAT_KNOCKBACK = 0.55;
export const CHARGED_SMACK_COOLDOWN = 1.9;
export const CHARGED_SMACK_LAUNCH_MIN_SCALE = 1.1;
export const CHARGED_SMACK_LAUNCH_MAX_SCALE = 1.75;

export const CHARGED_THROW_MIN_HOLD_SECONDS = 1.6;
export const CHARGED_THROW_ORBIT_RADIUS = 0.66;
export const CHARGED_THROW_ORBIT_UP = 0.55;
export const CHARGED_THROW_ORBIT_SPEED = 25.5;
export const CHARGED_THROW_MOUSE_LAUNCH_SCALE = 4.6;
export const CHARGED_THROW_MOUSE_UP_MULTIPLIER = 1.35;
export const CHARGED_THROW_BALL_SPEED = 58;
export const CHARGED_THROW_BALL_UP = 42;
export const CHARGED_THROW_BALL_SPIN = 34;

export const QUICK_TOSS_FULL_HOLD_SECONDS = 0.85;
export const QUICK_TOSS_MOUSE_LAUNCH_SCALE = 3.8;
export const QUICK_TOSS_MOUSE_UP_MULTIPLIER = 1.55;
export const QUICK_TOSS_BACK_LAUNCH_SCALE = 1.55;
export const QUICK_TOSS_BACK_UP_MULTIPLIER = 1.35;

export const THROW_SMACK_SUPPRESS_SECONDS = 0.35;

export const MISCHIEF_POINTS = Object.freeze({
  smack: 30,
  ballSmack: 6,
  grab: 10,
  throw: 15,
  taskComplete: 40,
  extract: 75,
});

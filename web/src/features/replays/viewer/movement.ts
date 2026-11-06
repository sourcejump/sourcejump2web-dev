// What a replay's movement shows once worked out at load: teleports, speeds, jumps (from daf's replay viewer).
// Every index into the per-tick arrays is in range by construction; the `!`s say so to the strict index check.
// Per-replay movement analysis. Everything here is derived once at load time so
// the render loop only ever indexes into typed arrays.

// Source Engine entity flags (m_fFlags). shavit-replay-recorder stores
// GetEntityFlags() verbatim, so these are the real engine values.
export const FL_ONGROUND = 1 << 0;
export const FL_DUCKING = 1 << 1;

// Button flags (IN_*).
export const IN_JUMP = 1 << 1;
export const IN_DUCK = 1 << 2;
export const IN_FORWARD = 1 << 3;
export const IN_BACK = 1 << 4;
// +left and +right turn the view with the keyboard instead of the mouse. Used
// in 74 and 49 of the 247 style-0 replays on the reference server.
export const IN_LEFT = 1 << 7;
export const IN_RIGHT = 1 << 8;
export const IN_MOVELEFT = 1 << 9;
export const IN_MOVERIGHT = 1 << 10;

// VEC_VIEW and VEC_DUCK_VIEW in CS:S (CS:GO uses 46.04 ducked).
export const EYE_HEIGHT_STANDING = 64;
export const EYE_HEIGHT_DUCKED = 47;

/**
 * Teleport thresholds, derived from all 247 style-0 replays on the server.
 *
 * sv_maxvelocity is 999999 there, so no speed limit separates a teleport from
 * fast movement. The discriminator is shape: real velocity persists across
 * ticks, a teleport does not. minDistance is only a noise floor.
 */
export interface TeleportThresholds {
  /** Never consider a displacement below this (units per tick). */
  minDistance: number;
  /** Flag when the step is this many times the local displacement. */
  spikeRatio: number;
  /** Flag unconditionally above this, for back-to-back stage teleports. */
  hardDistance: number;
  /** Half-width of the neighbourhood used for the local comparison. */
  neighbourhood: number;
}

export const DEFAULT_TELEPORT_THRESHOLDS: TeleportThresholds = {
  minDistance: 64,
  spikeRatio: 4,
  hardDistance: 2048,
  neighbourhood: 2,
};

export const enum EventKind {
  Teleport = 0,
  Takeoff = 1,
  Land = 2,
  Jump = 3,
  Duck = 4,
  Unduck = 5,
}

export interface MovementEvent {
  tick: number;
  kind: EventKind;
}

export interface RunTicks {
  start: number;
  end: number;
}

export class MovementAnalysis {
  /** 1 when the step from tick-1 to tick is a position discontinuity. */
  readonly discontinuity: Uint8Array;
  /** Distance between consecutive ticks, in units. Index 0 is 0. */
  readonly stepDistance: Float32Array;
  /** Horizontal speed in u/s at each tick. NaN where it cannot be derived. */
  readonly horizontalSpeed: Float32Array;
  /** Vertical speed in u/s at each tick. NaN where it cannot be derived. */
  readonly verticalSpeed: Float32Array;
  readonly events: MovementEvent[] = [];
  readonly teleportCount: number;

  constructor(
    readonly positions: Float32Array,
    readonly flags: Int32Array,
    readonly buttons: Int32Array,
    readonly tickCount: number,
    readonly tickRate: number,
    thresholds: TeleportThresholds = DEFAULT_TELEPORT_THRESHOLDS,
  ) {
    const n = tickCount;
    const p = positions;
    const step = new Float32Array(n);
    for (let t = 1; t < n; t++) {
      const o = t * 3;
      const dx = p[o]! - p[o - 3]!;
      const dy = p[o + 1]! - p[o - 2]!;
      const dz = p[o + 2]! - p[o - 1]!;
      step[t] = Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    this.stepDistance = step;

    const { minDistance, spikeRatio, hardDistance, neighbourhood } = thresholds;
    const mask = new Uint8Array(n);
    const neighbours: number[] = [];
    let teleports = 0;
    for (let t = 1; t < n; t++) {
      if (step[t]! < minDistance) continue;
      // Prefer neighbours that are themselves ordinary movement, so a pair of
      // back-to-back teleports cannot hide behind each other's magnitude.
      let local = 0;
      let found = false;
      neighbours.length = 0;
      for (let k = t - neighbourhood; k <= t + neighbourhood; k++) {
        if (k === t || k < 1 || k >= n) continue;
        neighbours.push(step[k]!);
        if (step[k]! >= minDistance) continue;
        found = true;
        if (step[k]! > local) local = step[k]!;
      }
      if (!found) {
        // Every neighbour is large too. That is what sustained fast movement
        // looks like, so compare against the middle of the neighbourhood rather
        // than against the run's ordinary baseline.
        if (neighbours.length === 0) continue;
        neighbours.sort((a, b) => a - b);
        local = neighbours[neighbours.length >> 1]!;
      }
      if (step[t]! >= hardDistance || step[t]! > local * spikeRatio) {
        mask[t] = 1;
        teleports++;
      }
    }
    this.discontinuity = mask;
    this.teleportCount = teleports;

    // Speed is normally the backward difference, which is the velocity during
    // the tick that ends at t. At a teleport the backward difference is the
    // warp distance and is physically meaningless, so use the forward
    // difference instead: that measures the velocity the player carries out of
    // the teleport, which is the number a telehop is judged on.
    const hSpeed = new Float32Array(n);
    const vSpeed = new Float32Array(n);
    for (let t = 0; t < n; t++) {
      let from = t - 1;
      let to = t;
      if (t === 0 || mask[t]! === 1) {
        from = t;
        to = t + 1;
      }
      if (from < 0 || to >= n || mask[to]! === 1) {
        hSpeed[t] = NaN;
        vSpeed[t] = NaN;
        continue;
      }
      const a = from * 3;
      const b = to * 3;
      const dx = p[b]! - p[a]!;
      const dy = p[b + 1]! - p[a + 1]!;
      hSpeed[t] = Math.sqrt(dx * dx + dy * dy) * tickRate;
      vSpeed[t] = (p[b + 2]! - p[a + 2]!) * tickRate;
    }
    this.horizontalSpeed = hSpeed;
    this.verticalSpeed = vSpeed;

    for (let t = 1; t < n; t++) {
      if (mask[t]! === 1)
        this.events.push({ tick: t, kind: EventKind.Teleport });
      const wasGround = (flags[t - 1]! & FL_ONGROUND) !== 0;
      const isGround = (flags[t]! & FL_ONGROUND) !== 0;
      if (wasGround && !isGround) {
        const jumped = ((buttons[t]! | buttons[t - 1]!) & IN_JUMP) !== 0;
        this.events.push({
          tick: t,
          kind: jumped ? EventKind.Jump : EventKind.Takeoff,
        });
      } else if (!wasGround && isGround) {
        this.events.push({ tick: t, kind: EventKind.Land });
      }
      const wasDuck = (flags[t - 1]! & FL_DUCKING) !== 0;
      const isDuck = (flags[t]! & FL_DUCKING) !== 0;
      if (wasDuck !== isDuck)
        this.events.push({
          tick: t,
          kind: isDuck ? EventKind.Duck : EventKind.Unduck,
        });
    }
    this.events.sort((a, b) => a.tick - b.tick);
  }

  isGrounded(tick: number): boolean {
    return (this.flags[tick]! & FL_ONGROUND) !== 0;
  }

  isDucking(tick: number): boolean {
    return (this.flags[tick]! & FL_DUCKING) !== 0;
  }

  eyeHeightAt(tick: number): number {
    return this.isDucking(tick) ? EYE_HEIGHT_DUCKED : EYE_HEIGHT_STANDING;
  }

  /** True when interpolating from tick to tick + 1 would cross a teleport. */
  breaksAfter(tick: number): boolean {
    const next = tick + 1;
    return next >= this.tickCount || this.discontinuity[next]! === 1;
  }

  /** True when the step arriving at tick was a teleport. */
  breaksBefore(tick: number): boolean {
    return (
      tick <= 0 || tick >= this.tickCount || this.discontinuity[tick]! === 1
    );
  }
}

/**
 * Workspace slot allocation policy
 * Zones: telegram, workspace identity
 * Owns bounded profile-wide letter selection and inactivity ordering.
 * Excludes liveness discovery, persistence, routing, and Telegram deletion;
 * a selection is a proposal, never authority to retire a binding.
 */

export const TELEGRAM_WORKSPACE_SLOTS = "abcdefghijklmnopqrstuvwxyz";

export class TelegramWorkspaceSlotUnavailableError extends Error {
  constructor() {
    super("Telegram Workspace slot reservation is unavailable.");
    this.name = "TelegramWorkspaceSlotUnavailableError";
  }
}

export interface TelegramWorkspaceSlotOccupancy {
  bindingKey: string;
  slot: string;
  inactiveSinceMs?: number;
  protection: "eligible" | "protected" | "unknown";
}

export type TelegramWorkspaceSlotAllocation =
  | { kind: "free"; slot: string }
  | { kind: "reclaim"; candidate: TelegramWorkspaceSlotOccupancy }
  | { kind: "blocked"; reason: "invalid-state" | "protected-capacity" };

/** A binding whose letter may be reassigned without touching its Thread, journals or accepted work. */
export interface TelegramWorkspaceReusableSlot {
  bindingKey: string;
  /** Uppercase display letter currently held by the binding. */
  slot: string;
  /** A live owner counts as most recently used, whatever its stored clocks say. */
  live: boolean;
  /** Last known use: inactivity start for detached bindings, otherwise the last binding update. */
  lastUsedMs: number;
}

/**
 * Metadata-only fallback for a full A-Z pool: pick the least recently used letter,
 * preferring detached bindings over live ones. Unlike pressure retirement this
 * ignores accepted-work protection because reuse deletes nothing.
 * Returns undefined for an empty or malformed candidate set.
 */
export function selectTelegramWorkspaceReusableSlot(
  candidates: readonly TelegramWorkspaceReusableSlot[],
): TelegramWorkspaceReusableSlot | undefined {
  const slots = new Set<string>();
  const keys = new Set<string>();
  for (const candidate of candidates) {
    if (
      !/^[A-Z]$/u.test(candidate.slot) ||
      !candidate.bindingKey ||
      !Number.isSafeInteger(candidate.lastUsedMs) ||
      candidate.lastUsedMs < 0 ||
      slots.has(candidate.slot) ||
      keys.has(candidate.bindingKey)
    )
      return undefined;
    slots.add(candidate.slot);
    keys.add(candidate.bindingKey);
  }
  const [selected] = [...candidates].sort(
    (left, right) =>
      Number(left.live) - Number(right.live) ||
      left.lastUsedMs - right.lastUsedMs ||
      left.slot.localeCompare(right.slot),
  );
  return selected ? { ...selected } : undefined;
}

function isSlot(slot: string): boolean {
  return /^[a-z]$/u.test(slot);
}

function isValidSnapshot(
  bindings: readonly TelegramWorkspaceSlotOccupancy[],
  reservedSlots: readonly string[],
  nowMs: number,
): boolean {
  if (!Number.isFinite(nowMs) || nowMs < 0) return false;
  const slots = new Set<string>();
  const keys = new Set<string>();
  for (const binding of bindings) {
    if (
      !isSlot(binding.slot) ||
      !binding.bindingKey ||
      slots.has(binding.slot) ||
      keys.has(binding.bindingKey)
    )
      return false;
    slots.add(binding.slot);
    keys.add(binding.bindingKey);
  }
  return reservedSlots.every(isSlot);
}

function eligibleByInactivity(
  bindings: readonly TelegramWorkspaceSlotOccupancy[],
  reservedSlots: readonly string[],
  nowMs: number,
): TelegramWorkspaceSlotOccupancy[] {
  const reserved = new Set(reservedSlots);
  return bindings
    .filter(
      (binding) =>
        binding.protection === "eligible" &&
        !reserved.has(binding.slot) &&
        typeof binding.inactiveSinceMs === "number" &&
        Number.isFinite(binding.inactiveSinceMs) &&
        binding.inactiveSinceMs >= 0 &&
        binding.inactiveSinceMs <= nowMs,
    )
    .sort(
      (left, right) =>
        left.inactiveSinceMs! - right.inactiveSinceMs! ||
        left.slot.charCodeAt(0) - right.slot.charCodeAt(0),
    );
}

/** Caller must recheck exact ownership and protected work before retirement. */
export function planTelegramWorkspaceSlotAllocation(input: {
  bindings: readonly TelegramWorkspaceSlotOccupancy[];
  reservedSlots: readonly string[];
  nowMs: number;
}): TelegramWorkspaceSlotAllocation {
  const { bindings, reservedSlots, nowMs } = input;
  if (!isValidSnapshot(bindings, reservedSlots, nowMs)) {
    return { kind: "blocked", reason: "invalid-state" };
  }
  const occupied = new Set([
    ...bindings.map((binding) => binding.slot),
    ...reservedSlots,
  ]);
  for (const slot of TELEGRAM_WORKSPACE_SLOTS) {
    if (!occupied.has(slot)) return { kind: "free", slot };
  }
  const candidate = eligibleByInactivity(bindings, reservedSlots, nowMs)[0];
  return candidate
    ? { kind: "reclaim", candidate: { ...candidate } }
    : { kind: "blocked", reason: "protected-capacity" };
}

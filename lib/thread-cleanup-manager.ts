/**
 * Proof-only candidate planning for inactive Telegram Workspace Thread cleanup
 * Zones: telegram threads, workspace lifecycle
 * Owns fail-closed cleanup eligibility projection without persistence or Bot API effects
 */

import { createHash, randomUUID } from "node:crypto";

import {
  publishTelegramPrivateFile,
  readTelegramPrivateFile,
  TelegramPrivateFileError,
  withTelegramFileTransaction,
} from "./locks.ts";
import { getTelegramJournalPublicationPaths } from "./paths.ts";
import {
  isWireRecord as isObject,
  hasOnlyWireKeys as onlyKeys,
  isNonNegativeWireInteger as safeTime,
} from "./wire.ts";
import type {
  TelegramWorkspaceDeletionPermit,
  TelegramWorkspaceDestructiveFence,
  TelegramWorkspaceRetirementFence,
  TelegramWorkspaceAdmissionLedger,
  TelegramWorkspaceAdmissionOwner,
} from "./workspace-admission.ts";
import { isTelegramWorkspaceRetirementFence } from "./workspace-admission.ts";
import type { TelegramTopicTargetStore, TelegramWorkspaceThreadBinding } from "./threads.ts";
import type { TelegramWorkspaceOperationRunner } from "./workspace-retirement.ts";
import type { TelegramWorkspaceThreadDeletionTransport } from "./telegram-api.ts";
import type { TelegramProcessLiveness } from "./process-identity.ts";

export interface TelegramThreadCleanupBindingSnapshot {
  cwd: string;
  workspaceKey: string;
  sessionId?: string;
  sessionKey?: string;
  instanceSlot: string;
  slot?: string;
  bindingKey: string;
  target: { chatId: number; threadId: number };
  inactiveSinceMs?: number;
  updatedAtMs: number;
}

export type TelegramThreadCleanupProtectionState =
  "clear" | "protected" | "unknown";

export interface TelegramThreadCleanupProtectionEvidence {
  bindingKey: string;
  target: { chatId: number; threadId: number };
  liveOwner: TelegramThreadCleanupProtectionState;
  acceptedWork: TelegramThreadCleanupProtectionState;
  deliveryAuthority: TelegramThreadCleanupProtectionState;
}

export interface TelegramThreadCleanupCandidate {
  profileName: string;
  bindingKey: string;
  cwd: string;
  workspaceKey: string;
  sessionId?: string;
  sessionKey?: string;
  instanceSlot: string;
  /** Null is explicit absence in reviewed work; it never denotes a reusable letter. */
  slot: string | null;
  target: { chatId: number; threadId: number };
  inactiveSinceMs: number;
  bindingUpdatedAtMs: number;
}

function targetKey(target: { chatId: number; threadId: number }): string {
  return `${target.chatId}:${target.threadId}`;
}

function validTarget(target: { chatId: number; threadId: number }): boolean {
  return (
    Number.isSafeInteger(target.chatId) &&
    Number.isSafeInteger(target.threadId) &&
    target.threadId > 0
  );
}

function validSessionIdentity(value: {
  sessionId?: unknown;
  sessionKey?: unknown;
}): boolean {
  if (value.sessionId === undefined && value.sessionKey === undefined)
    return true;
  if (
    typeof value.sessionId !== "string" ||
    !value.sessionId ||
    value.sessionId !== value.sessionId.trim() ||
    Buffer.byteLength(value.sessionId, "utf8") > 256 ||
    typeof value.sessionKey !== "string" ||
    !/^[a-f0-9]{64}$/u.test(value.sessionKey)
  ) {
    return false;
  }
  return (
    createHash("sha256").update(value.sessionId).digest("hex") ===
    value.sessionKey
  );
}

/** Returns no candidates when any identity/evidence ambiguity exists. */
export function planTelegramInactiveThreadCleanup(input: {
  profileName: string;
  bindings: readonly TelegramThreadCleanupBindingSnapshot[];
  protection: readonly TelegramThreadCleanupProtectionEvidence[];
  reservedTargets?: readonly { chatId: number; threadId: number }[];
  provisioningTargets?: readonly { chatId: number; threadId: number }[];
  cleanupTargets?: readonly { chatId: number; threadId: number }[];
}): TelegramThreadCleanupCandidate[] {
  if (!input.profileName) return [];
  const bindingKeys = new Set<string>();
  const bindingTargets = new Set<string>();
  for (const binding of input.bindings) {
    const key = targetKey(binding.target);
    const slot = binding.slot;
    if (
      !binding.bindingKey ||
      !binding.cwd ||
      !binding.workspaceKey ||
      !binding.instanceSlot ||
      (slot !== undefined && (typeof slot !== "string" || !/^[A-Z]$/u.test(slot))) ||
      !validSessionIdentity(binding) ||
      !validTarget(binding.target) ||
      bindingKeys.has(binding.bindingKey) ||
      bindingTargets.has(key)
    )
      return [];
    bindingKeys.add(binding.bindingKey);
    bindingTargets.add(key);
  }
  const evidenceByBinding = new Map<
    string,
    TelegramThreadCleanupProtectionEvidence
  >();
  for (const evidence of input.protection) {
    if (
      !evidence.bindingKey ||
      evidenceByBinding.has(evidence.bindingKey) ||
      !validTarget(evidence.target)
    )
      return [];
    evidenceByBinding.set(evidence.bindingKey, evidence);
  }
  const competingTargets = [
    ...(input.reservedTargets ?? []),
    ...(input.provisioningTargets ?? []),
    ...(input.cleanupTargets ?? []),
  ];
  if (competingTargets.some((target) => !validTarget(target))) return [];
  const competing = new Set(competingTargets.map(targetKey));
  const candidates: TelegramThreadCleanupCandidate[] = [];
  for (const binding of input.bindings) {
    const inactiveSinceMs = binding.inactiveSinceMs;
    const slot = binding.slot;
    if (
      !Number.isSafeInteger(inactiveSinceMs) ||
      inactiveSinceMs === undefined ||
      inactiveSinceMs < 0 ||
      !Number.isSafeInteger(binding.updatedAtMs) ||
      binding.updatedAtMs < inactiveSinceMs
    )
      continue;
    const evidence = evidenceByBinding.get(binding.bindingKey);
    if (
      !evidence ||
      targetKey(evidence.target) !== targetKey(binding.target) ||
      evidence.liveOwner !== "clear" ||
      evidence.acceptedWork !== "clear" ||
      evidence.deliveryAuthority !== "clear" ||
      competing.has(targetKey(binding.target))
    )
      continue;
    candidates.push({
      profileName: input.profileName,
      bindingKey: binding.bindingKey,
      cwd: binding.cwd,
      workspaceKey: binding.workspaceKey,
      ...(binding.sessionId && binding.sessionKey
        ? { sessionId: binding.sessionId, sessionKey: binding.sessionKey }
        : {}),
      instanceSlot: binding.instanceSlot,
      slot: slot ?? null,
      target: { ...binding.target },
      inactiveSinceMs,
      bindingUpdatedAtMs: binding.updatedAtMs,
    });
  }
  return candidates.sort((left, right) =>
    left.bindingKey.localeCompare(right.bindingKey),
  );
}

/** Read ports for the bindings and target claims that cleanup evidence is captured from. */
export interface TelegramInactiveThreadCleanupEvidencePorts<
  TBinding extends TelegramThreadCleanupBindingSnapshot,
> {
  listBindings(): readonly TBinding[];
  getProtection(binding: TBinding): {
    liveOwner: TelegramThreadCleanupProtectionState;
    acceptedWork: TelegramThreadCleanupProtectionState;
    deliveryAuthority: TelegramThreadCleanupProtectionState;
  };
  listReservations(): readonly {
    target: { chatId: number; threadId: number };
  }[];
  listPendingProvisions(): readonly {
    target?: { chatId: number; threadId: number };
  }[];
  listPendingCleanups(): readonly {
    target: { chatId: number; threadId: number };
  }[];
}

export function captureTelegramInactiveThreadCleanupEvidence<
  TBinding extends TelegramThreadCleanupBindingSnapshot,
>(
  input: TelegramInactiveThreadCleanupEvidencePorts<TBinding> & {
    profileName: string;
  },
): Parameters<typeof planTelegramInactiveThreadCleanup>[0] {
  const sourceBindings = input.listBindings();
  const bindings = sourceBindings.map((binding) => ({
    cwd: binding.cwd,
    workspaceKey: binding.workspaceKey,
    ...(binding.sessionId && binding.sessionKey
      ? { sessionId: binding.sessionId, sessionKey: binding.sessionKey }
      : {}),
    instanceSlot: binding.instanceSlot,
    ...(binding.slot === undefined ? {} : { slot: binding.slot }),
    bindingKey: binding.bindingKey,
    target: { ...binding.target },
    ...(binding.inactiveSinceMs === undefined
      ? {}
      : { inactiveSinceMs: binding.inactiveSinceMs }),
    updatedAtMs: binding.updatedAtMs,
  }));
  const protection = sourceBindings.map((source, index) => {
    const binding = bindings[index]!;
    try {
      return {
        bindingKey: binding.bindingKey,
        target: { ...binding.target },
        ...input.getProtection(source),
      };
    } catch {
      return {
        bindingKey: binding.bindingKey,
        target: { ...binding.target },
        liveOwner: "unknown" as const,
        acceptedWork: "unknown" as const,
        deliveryAuthority: "unknown" as const,
      };
    }
  });
  return {
    profileName: input.profileName,
    bindings,
    protection,
    reservedTargets: input
      .listReservations()
      .map((entry) => ({ ...entry.target })),
    provisioningTargets: input
      .listPendingProvisions()
      .flatMap((entry) => (entry.target ? [{ ...entry.target }] : [])),
    cleanupTargets: input
      .listPendingCleanups()
      .map((entry) => ({ ...entry.target })),
  };
}

export function createTelegramInactiveThreadCleanupReviewRuntime<
  TBinding extends TelegramThreadCleanupBindingSnapshot,
>(
  deps: TelegramInactiveThreadCleanupEvidencePorts<TBinding> & {
    getProfileName(): string;
    getWorkStore(): TelegramThreadCleanupWorkStore;
    runWorkspaceOperation<T>(
      input: {
        operationId: string;
        operationKind: string;
        scopes: readonly [{ kind: "profile" }];
      },
      operation: () => Promise<T>,
    ): Promise<T>;
  },
): { review(): Promise<{ count: number; operationId?: string }> } {
  return {
    review() {
      return deps.runWorkspaceOperation(
        {
          operationId: `thread-cleanup-review:${randomUUID()}`,
          operationKind: "thread-cleanup-review",
          scopes: [{ kind: "profile" }],
        },
        async () => {
          const evidence = captureTelegramInactiveThreadCleanupEvidence({
            profileName: deps.getProfileName(),
            listBindings: deps.listBindings,
            getProtection: deps.getProtection,
            listReservations: deps.listReservations,
            listPendingProvisions: deps.listPendingProvisions,
            listPendingCleanups: deps.listPendingCleanups,
          });
          const candidates = planTelegramInactiveThreadCleanup(evidence);
          if (candidates.length === 0) return { count: 0 };
          const digest = createHash("sha256")
            .update(JSON.stringify(candidates))
            .digest("hex")
            .slice(0, 32);
          const operationId = `thread-cleanup:${digest}`;
          deps.getWorkStore().prepare(operationId, candidates);
          return { count: candidates.length, operationId };
        },
      );
    },
  };
}

export type TelegramThreadCleanupWorkState =
  "prepared" | "outcome-unknown" | "deleted";
export type TelegramThreadCleanupWorkEntry = TelegramThreadCleanupCandidate & {
  state: TelegramThreadCleanupWorkState;
  updatedAtMs: number;
  issuedAtMs?: number;
  permitOperationId?: string;
  permitIntentId?: string;
  permitLeaderEpoch?: number | string;
  deletedAtMs?: number;
};
export interface TelegramThreadCleanupWorkSet {
  operationId: string;
  createdAtMs: number;
  entries: TelegramThreadCleanupWorkEntry[];
}
interface TelegramThreadCleanupWorkFile {
  version: 1;
  profileName: string;
  tokenSha256: string;
  workSets: TelegramThreadCleanupWorkSet[];
}
export type TelegramThreadCleanupDeletionPermit =
  TelegramWorkspaceDeletionPermit;
export type TelegramThreadCleanupFence = TelegramWorkspaceRetirementFence;

export interface TelegramThreadCleanupWorkStore {
  prepare(
    operationId: string,
    candidates: readonly TelegramThreadCleanupCandidate[],
  ): { prepared: boolean; workSet: TelegramThreadCleanupWorkSet };
  recordDeletionIssued(input: {
    operationId: string;
    bindingKey: string;
    bindingUpdatedAtMs: number;
    permit: TelegramThreadCleanupDeletionPermit;
  }): { recorded: boolean; entry: TelegramThreadCleanupWorkEntry };
  confirmDeleted(input: { operationId: string; bindingKey: string }): {
    confirmed: boolean;
    entry: TelegramThreadCleanupWorkEntry;
  };
  list(): TelegramThreadCleanupWorkSet[];
}

function validateWorkSet(
  value: unknown,
  profileName: string,
): TelegramThreadCleanupWorkSet {
  if (
    !isObject(value) ||
    !onlyKeys(value, ["operationId", "createdAtMs", "entries"]) ||
    typeof value.operationId !== "string" ||
    !value.operationId ||
    !safeTime(value.createdAtMs) ||
    !Array.isArray(value.entries) ||
    value.entries.length === 0
  )
    throw new Error("Telegram Thread cleanup work-set schema is invalid.");
  const createdAtMs = value.createdAtMs as number;
  const entries = value.entries.map((raw) => {
    if (
      !isObject(raw) ||
      !onlyKeys(raw, [
        "profileName",
        "bindingKey",
        "cwd",
        "workspaceKey",
        "sessionId",
        "sessionKey",
        "instanceSlot",
        "slot",
        "target",
        "inactiveSinceMs",
        "bindingUpdatedAtMs",
        "state",
        "updatedAtMs",
        "issuedAtMs",
        "permitOperationId",
        "permitIntentId",
        "permitLeaderEpoch",
        "deletedAtMs",
      ]) ||
      raw.profileName !== profileName ||
      typeof raw.bindingKey !== "string" ||
      !raw.bindingKey ||
      typeof raw.cwd !== "string" ||
      !raw.cwd ||
      typeof raw.workspaceKey !== "string" ||
      !raw.workspaceKey ||
      !validSessionIdentity(raw) ||
      typeof raw.instanceSlot !== "string" ||
      !raw.instanceSlot ||
      (raw.slot !== null && (typeof raw.slot !== "string" || !/^[A-Z]$/u.test(raw.slot))) ||
      !isObject(raw.target) ||
      !onlyKeys(raw.target, ["chatId", "threadId"]) ||
      !validTarget(
        raw.target as unknown as { chatId: number; threadId: number },
      ) ||
      !safeTime(raw.inactiveSinceMs) ||
      !safeTime(raw.bindingUpdatedAtMs) ||
      (raw.bindingUpdatedAtMs as number) < (raw.inactiveSinceMs as number) ||
      !safeTime(raw.updatedAtMs)
    )
      throw new Error("Telegram Thread cleanup entry schema is invalid.");
    const base = {
      profileName,
      bindingKey: raw.bindingKey,
      cwd: raw.cwd,
      workspaceKey: raw.workspaceKey,
      ...(typeof raw.sessionId === "string" &&
      typeof raw.sessionKey === "string"
        ? { sessionId: raw.sessionId, sessionKey: raw.sessionKey }
        : {}),
      instanceSlot: raw.instanceSlot,
      slot: raw.slot,
      target: {
        chatId: raw.target.chatId as number,
        threadId: raw.target.threadId as number,
      },
      inactiveSinceMs: raw.inactiveSinceMs as number,
      bindingUpdatedAtMs: raw.bindingUpdatedAtMs as number,
      updatedAtMs: raw.updatedAtMs as number,
    };
    if (base.updatedAtMs < base.bindingUpdatedAtMs)
      throw new Error("Telegram Thread cleanup entry clock is invalid.");
    const noPermit =
      raw.permitOperationId === undefined &&
      raw.permitIntentId === undefined &&
      raw.permitLeaderEpoch === undefined;
    if (
      raw.state === "prepared" &&
      raw.issuedAtMs === undefined &&
      raw.deletedAtMs === undefined &&
      noPermit
    )
      return { ...base, state: "prepared" as const };
    const validPermit =
      typeof raw.permitOperationId === "string" &&
      !!raw.permitOperationId &&
      typeof raw.permitIntentId === "string" &&
      !!raw.permitIntentId &&
      (typeof raw.permitLeaderEpoch === "string" ||
        Number.isSafeInteger(raw.permitLeaderEpoch));
    if (
      raw.state === "outcome-unknown" &&
      safeTime(raw.issuedAtMs) &&
      validPermit &&
      raw.issuedAtMs === base.updatedAtMs &&
      raw.deletedAtMs === undefined
    )
      return {
        ...base,
        state: "outcome-unknown" as const,
        issuedAtMs: raw.issuedAtMs,
        permitOperationId: raw.permitOperationId as string,
        permitIntentId: raw.permitIntentId as string,
        permitLeaderEpoch: raw.permitLeaderEpoch as number | string,
      };
    if (
      raw.state === "deleted" &&
      safeTime(raw.issuedAtMs) &&
      validPermit &&
      safeTime(raw.deletedAtMs) &&
      raw.deletedAtMs === base.updatedAtMs &&
      raw.deletedAtMs >= raw.issuedAtMs
    )
      return {
        ...base,
        state: "deleted" as const,
        issuedAtMs: raw.issuedAtMs,
        permitOperationId: raw.permitOperationId as string,
        permitIntentId: raw.permitIntentId as string,
        permitLeaderEpoch: raw.permitLeaderEpoch as number | string,
        deletedAtMs: raw.deletedAtMs,
      };
    throw new Error("Telegram Thread cleanup entry state is invalid.");
  });
  if (
    entries.some((entry) => entry.updatedAtMs < createdAtMs) ||
    new Set(entries.map((entry) => entry.bindingKey)).size !== entries.length ||
    new Set(entries.map((entry) => targetKey(entry.target))).size !==
      entries.length
  )
    throw new Error("Telegram Thread cleanup work-set identity is ambiguous.");
  return { operationId: value.operationId, createdAtMs, entries };
}

function sameCandidates(
  left: readonly TelegramThreadCleanupCandidate[],
  right: readonly TelegramThreadCleanupCandidate[],
): boolean {
  const keys = ["profileName", "bindingKey", "cwd", "workspaceKey", "sessionId", "sessionKey", "instanceSlot", "slot", "inactiveSinceMs", "bindingUpdatedAtMs"] as const;
  return left.length === right.length && left.every((candidate, index) => {
    const other = right[index]!;
    return keys.every(key => candidate[key] === other[key]) && targetKey(candidate.target) === targetKey(other.target);
  });
}

function parseTelegramThreadCleanupWorkFile(
  value: unknown,
  profileName: string,
  tokenSha256: string,
): TelegramThreadCleanupWorkFile {
  if (
    !isObject(value) ||
    !onlyKeys(value, ["version", "profileName", "tokenSha256", "workSets"]) ||
    value.version !== 1 ||
    value.profileName !== profileName ||
    value.tokenSha256 !== tokenSha256 ||
    !Array.isArray(value.workSets)
  )
    throw new Error(
      "Telegram Thread cleanup store identity or schema does not match.",
    );
  const workSets = value.workSets.map((workSet) =>
    validateWorkSet(workSet, profileName),
  );
  if (
    new Set(workSets.map((workSet) => workSet.operationId)).size !==
    workSets.length
  )
    throw new Error("Telegram Thread cleanup operation identity is ambiguous.");
  return { version: 1, profileName, tokenSha256, workSets };
}

export function createTelegramThreadCleanupWorkStore(options: {
  path: string;
  runtimeDir?: string;
  profileName: string;
  tokenSha256: string;
  /** Exact captured ledger identity; standalone fixtures may use the plain profile identity. */
  admissionProfileKey?: string;
  maxWorkSets?: number;
  maxBytes?: number;
  getNowMs?: () => number;
  onPublicationBoundary?: (
    boundary: "after-write-before-rename" | "after-rename",
  ) => void;
}): TelegramThreadCleanupWorkStore {
  options = { ...options };
  const publicationPaths = getTelegramJournalPublicationPaths(
    options.path,
    options.runtimeDir,
  );
  const maxWorkSets = options.maxWorkSets ?? 32;
  const maxBytes = options.maxBytes ?? 1024 * 1024;
  const now = options.getNowMs ?? Date.now;
  if (
    !options.path ||
    !options.profileName ||
    !/^[a-f0-9]{64}$/u.test(options.tokenSha256) ||
    !Number.isSafeInteger(maxWorkSets) ||
    maxWorkSets <= 0 ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes <= 0
  )
    throw new Error("Telegram Thread cleanup store options are invalid.");
  const empty = (): TelegramThreadCleanupWorkFile => ({
    version: 1,
    profileName: options.profileName,
    tokenSha256: options.tokenSha256,
    workSets: [],
  });
  const read = (): TelegramThreadCleanupWorkFile => {
    let text: string | undefined;
    try {
      text = readTelegramPrivateFile(options.path, maxBytes);
    } catch (error) {
      if (!(error instanceof TelegramPrivateFileError)) throw error;
      throw new Error(
        error.failure === "changed"
          ? "Telegram Thread cleanup store changed during inspection."
          : "Telegram Thread cleanup store is not a bounded private regular file.",
        { cause: error },
      );
    }
    return text === undefined
      ? empty()
      : parseTelegramThreadCleanupWorkFile(
          JSON.parse(text) as unknown,
          options.profileName,
          options.tokenSha256,
        );
  };
  const publish = (file: TelegramThreadCleanupWorkFile): void => {
    if (file.workSets.length > maxWorkSets)
      throw new Error("Telegram Thread cleanup work-set capacity reached.");
    const serialized = `${JSON.stringify(file, null, 2)}\n`;
    if (Buffer.byteLength(serialized) > maxBytes)
      throw new Error("Telegram Thread cleanup byte capacity reached.");
    publishTelegramPrivateFile(
      options.path,
      publicationPaths.temporaryBasePath,
      serialized,
      "Telegram Thread cleanup",
      options.onPublicationBoundary,
    );
  };
  const mutate = <T>(
    operation: (file: TelegramThreadCleanupWorkFile) => T,
  ): T =>
    withTelegramFileTransaction(publicationPaths.transactionPath, () =>
      operation(read()),
    );
  return {
    prepare(operationId, candidates) {
      if (
        !operationId ||
        candidates.length === 0 ||
        candidates.some(
          (candidate) => candidate.profileName !== options.profileName,
        )
      )
        throw new Error("Telegram Thread cleanup work-set is invalid.");
      return mutate((file) => {
        const existing = file.workSets.find(
          (workSet) => workSet.operationId === operationId,
        );
        if (existing) {
          const projected = existing.entries.map(
            ({
              state: _state,
              updatedAtMs: _updated,
              issuedAtMs: _issued,
              permitOperationId: _permitOperation,
              permitIntentId: _permitIntent,
              permitLeaderEpoch: _permitEpoch,
              deletedAtMs: _deleted,
              ...candidate
            }) => candidate,
          );
          if (!sameCandidates(projected, candidates))
            throw new Error("Telegram Thread cleanup operation conflicts.");
          return { prepared: false, workSet: structuredClone(existing) };
        }
        const atMs = now();
        if (!safeTime(atMs))
          throw new Error("Telegram Thread cleanup clock is invalid.");
        const workSet = validateWorkSet(
          {
            operationId,
            createdAtMs: atMs,
            entries: candidates.map((candidate) => ({
              ...structuredClone(candidate),
              state: "prepared",
              updatedAtMs: atMs,
            })),
          },
          options.profileName,
        );
        publish({ ...file, workSets: [...file.workSets, workSet] });
        return { prepared: true, workSet: structuredClone(workSet) };
      });
    },
    recordDeletionIssued(input) {
      return mutate((file) => {
        const workSet = file.workSets.find(
          (candidate) => candidate.operationId === input.operationId,
        );
        const entry = workSet?.entries.find(
          (candidate) => candidate.bindingKey === input.bindingKey,
        );
        const permit = input.permit;
        if (
          !workSet ||
          !entry ||
          entry.bindingUpdatedAtMs !== input.bindingUpdatedAtMs ||
          permit.destructiveKind !== "manual-thread-cleanup" ||
          permit.profileKey !== (options.admissionProfileKey ?? entry.profileName) ||
          permit.bindingKey !== entry.bindingKey ||
          permit.slot !== entry.slot ||
          targetKey(permit.target) !== targetKey(entry.target) ||
          !permit.operationId ||
          permit.retirementIntentId !== workSet.operationId ||
          !safeTime(permit.issuedAtMs)
        )
          throw new Error(
            "Telegram Thread cleanup entry or deletion permit is stale or mismatched.",
          );
        if (entry.state !== "prepared") {
          const exact =
            entry.permitOperationId === permit.operationId &&
            entry.permitIntentId === permit.retirementIntentId &&
            entry.permitLeaderEpoch === permit.leaderEpoch;
          if (!exact)
            throw new Error(
              "Telegram Thread cleanup deletion permit conflicts with retained work.",
            );
          return { recorded: false, entry: structuredClone(entry) };
        }
        const atMs = now();
        if (
          !safeTime(atMs) ||
          atMs < entry.updatedAtMs ||
          atMs < permit.issuedAtMs
        )
          throw new Error("Telegram Thread cleanup clock is invalid.");
        entry.state = "outcome-unknown";
        entry.issuedAtMs = atMs;
        entry.updatedAtMs = atMs;
        entry.permitOperationId = permit.operationId;
        entry.permitIntentId = permit.retirementIntentId;
        entry.permitLeaderEpoch = permit.leaderEpoch;
        publish(file);
        return { recorded: true, entry: structuredClone(entry) };
      });
    },
    confirmDeleted(input) {
      return mutate((file) => {
        const entry = file.workSets
          .find((candidate) => candidate.operationId === input.operationId)
          ?.entries.find(
            (candidate) => candidate.bindingKey === input.bindingKey,
          );
        if (!entry)
          throw new Error("Telegram Thread cleanup entry is missing.");
        if (entry.state === "deleted")
          return { confirmed: false, entry: structuredClone(entry) };
        if (entry.state !== "outcome-unknown")
          throw new Error(
            "Telegram Thread cleanup deletion confirmation is premature.",
          );
        const atMs = now();
        if (!safeTime(atMs) || atMs < entry.updatedAtMs)
          throw new Error("Telegram Thread cleanup clock is invalid.");
        entry.state = "deleted";
        entry.deletedAtMs = atMs;
        entry.updatedAtMs = atMs;
        publish(file);
        return { confirmed: true, entry: structuredClone(entry) };
      });
    },
    list() {
      return structuredClone(
        withTelegramFileTransaction(
          publicationPaths.transactionPath,
          () => read().workSets,
        ),
      );
    },
  };
}

export async function commitTelegramInactiveThreadCleanup(input: {
  store: TelegramThreadCleanupWorkStore;
  operationId: string;
  bindingKey: string;
  commitBinding(): Promise<boolean>;
}): Promise<boolean> {
  if (!(await input.commitBinding())) return false;
  input.store.confirmDeleted({
    operationId: input.operationId,
    bindingKey: input.bindingKey,
  });
  return true;
}

export async function executeTelegramInactiveThreadCleanup(input: {
  store: TelegramThreadCleanupWorkStore;
  operationId: string;
  bindingKey: string;
  withWorkspaceDeletionBoundary<T>(operation: () => Promise<T>): Promise<T>;
  loadFreshEvidence(): Promise<
    Parameters<typeof planTelegramInactiveThreadCleanup>[0]
  >;
  acquireDeletionPermit(
    candidate: TelegramThreadCleanupCandidate,
  ): Promise<
    | { kind: "issued"; permit: TelegramThreadCleanupDeletionPermit }
    | { kind: "blocked" | "already-issued" }
  >;
  deleteWithPermit(
    permit: TelegramThreadCleanupDeletionPermit,
    candidate: TelegramThreadCleanupCandidate,
  ): Promise<void>;
}): Promise<{
  status: "deleted" | "blocked" | "outcome-unknown";
  entry?: TelegramThreadCleanupWorkEntry;
}> {
  return input.withWorkspaceDeletionBoundary(async () => {
    const workSet = input.store
      .list()
      .find((candidate) => candidate.operationId === input.operationId);
    const retained = workSet?.entries.find(
      (candidate) => candidate.bindingKey === input.bindingKey,
    );
    if (!retained) return { status: "blocked" };
    if (retained.state === "deleted")
      return { status: "deleted", entry: retained };
    if (retained.state === "outcome-unknown")
      return { status: "outcome-unknown", entry: retained };
    const planned = planTelegramInactiveThreadCleanup(
      await input.loadFreshEvidence(),
    );
    const fresh = planned.find(
      (candidate) => candidate.bindingKey === retained.bindingKey,
    );
    const retainedCandidate = (({
      state: _state,
      updatedAtMs: _updated,
      issuedAtMs: _issued,
      permitOperationId: _permitOperation,
      permitIntentId: _permitIntent,
      permitLeaderEpoch: _permitEpoch,
      deletedAtMs: _deleted,
      ...candidate
    }) => candidate)(retained);
    if (!fresh || !sameCandidates([fresh], [retainedCandidate]))
      return { status: "blocked" };
    const permitResult = await input.acquireDeletionPermit(fresh);
    if (permitResult.kind !== "issued") return { status: "blocked" };
    const recorded = input.store.recordDeletionIssued({
      operationId: input.operationId,
      bindingKey: input.bindingKey,
      bindingUpdatedAtMs: retained.bindingUpdatedAtMs,
      permit: permitResult.permit,
    });
    if (!recorded.recorded)
      return { status: "outcome-unknown", entry: recorded.entry };
    await input.deleteWithPermit(permitResult.permit, fresh);
    const confirmed = input.store.confirmDeleted({
      operationId: input.operationId,
      bindingKey: input.bindingKey,
    });
    return { status: "deleted", entry: confirmed.entry };
  });
}

export function createTelegramThreadCleanupPermitRuntime(deps: {
  ledger: {
    getProfileKey(): string;
    read(): { fence?: TelegramWorkspaceDestructiveFence };
    acquireThreadCleanupFence(input: {
      operationId: string;
      cleanupWorkSetId: string;
      bindingKey: string;
      slot: string | null;
      target: { chatId: number; threadId: number };
      leaderEpoch: number | string;
      cleanupRequestedAtMs: number;
    }):
      | {
          kind: "acquired";
          fence: TelegramThreadCleanupFence;
          resumed: boolean;
        }
      | { kind: "blocked"; reason: string };
    adoptThreadCleanupFence(
      fence: TelegramThreadCleanupFence,
      replacement: {
        owner: { processId: number; processBirthId: string };
        leaderEpoch: number | string;
      },
    ): TelegramThreadCleanupFence;
    issueThreadCleanupDeletionPermit(fence: TelegramThreadCleanupFence):
      | {
          kind: "issued";
          fence: TelegramThreadCleanupFence;
          permit: TelegramThreadCleanupDeletionPermit;
        }
      | { kind: "already-issued"; fence: TelegramThreadCleanupFence };
    confirmThreadCleanupAbsence(
      fence: TelegramThreadCleanupFence,
    ): TelegramThreadCleanupFence;
    releaseUnissuedThreadCleanupFence(
      fence: TelegramThreadCleanupFence,
    ): boolean;
    completeThreadCleanupFence(fence: TelegramThreadCleanupFence): boolean;
  };
  getLeaderEpoch(): number | string | undefined;
  getProfileName(): string;
  getOwner(): { processId: number; processBirthId: string };
  canAdoptFence(fence: TelegramThreadCleanupFence): boolean;
  revalidateUnderFence(
    candidate: TelegramThreadCleanupCandidate,
  ): Promise<boolean>;
  getNowMs?: () => number;
}): {
  acquire(
    candidate: TelegramThreadCleanupCandidate,
    workSetId: string,
  ): Promise<
    | {
        kind: "issued";
        fence: TelegramThreadCleanupFence;
        permit: TelegramThreadCleanupDeletionPermit;
      }
    | { kind: "blocked" }
    | { kind: "already-issued" }
  >;
  diagnoseRecovery(
    candidate: TelegramThreadCleanupCandidate,
    workSetId: string,
  ):
    | "none"
    | "fenced"
    | "deletion-issued"
    | "commit-ready"
    | "authority-blocked";
  findCommitReady(
    candidate: TelegramThreadCleanupCandidate,
    workSetId: string,
  ): TelegramThreadCleanupFence | undefined;
  settleDeleted(
    fence: TelegramThreadCleanupFence,
    commit: () => Promise<boolean>,
  ): Promise<"completed" | "commit-pending">;
} {
  const now = deps.getNowMs ?? Date.now;
  const findExactFence = (
    candidate: TelegramThreadCleanupCandidate,
    workSetId: string,
  ) => {
    const operationId = `thread-cleanup-fence:${createHash("sha256")
      .update(`${workSetId}\u0000${candidate.bindingKey}`, "utf8")
      .digest("hex")}`;
    const fence = deps.ledger.read().fence;
    return fence?.operationId === operationId &&
      fence.destructiveKind === "manual-thread-cleanup" &&
      fence.profileKey === deps.ledger.getProfileKey() &&
      fence.retirementIntentId === workSetId &&
      fence.bindingKey === candidate.bindingKey &&
      fence.slot === candidate.slot &&
      targetKey(fence.target) === targetKey(candidate.target)
      ? fence
      : undefined;
  };
  const adoptExactFence = (
    candidate: TelegramThreadCleanupCandidate,
    workSetId: string,
  ) => {
    let fence = findExactFence(candidate, workSetId);
    const leaderEpoch = deps.getLeaderEpoch();
    if (!fence || leaderEpoch === undefined) return undefined;
    const owner = deps.getOwner();
    if (
      fence.leaderEpoch !== leaderEpoch ||
      fence.owner.processId !== owner.processId ||
      fence.owner.processBirthId !== owner.processBirthId
    ) {
      if (!deps.canAdoptFence(fence)) return undefined;
      try {
        const adopted = deps.ledger.adoptThreadCleanupFence(fence, {
          owner,
          leaderEpoch,
        });
        if (adopted.destructiveKind !== "manual-thread-cleanup")
          return undefined;
        fence = adopted;
      } catch {
        return undefined;
      }
    }
    return deps.getLeaderEpoch() === leaderEpoch ? fence : undefined;
  };
  return {
    diagnoseRecovery(candidate, workSetId) {
      const fence = deps.ledger.read().fence;
      if (!fence) return "none";
      const exact = findExactFence(candidate, workSetId);
      if (!exact) return "authority-blocked";
      const owner = deps.getOwner();
      const leaderEpoch = deps.getLeaderEpoch();
      const owns =
        exact.owner.processId === owner.processId &&
        exact.owner.processBirthId === owner.processBirthId &&
        exact.leaderEpoch === leaderEpoch;
      return owns || deps.canAdoptFence(exact)
        ? exact.phase
        : "authority-blocked";
    },
    findCommitReady(candidate, workSetId) {
      const fence = adoptExactFence(candidate, workSetId);
      return fence?.phase === "commit-ready" ? fence : undefined;
    },
    async acquire(candidate, workSetId) {
      const leaderEpoch = deps.getLeaderEpoch();
      if (
        leaderEpoch === undefined ||
        candidate.profileName.length === 0 ||
        candidate.profileName !== deps.getProfileName()
      )
        return { kind: "blocked" };
      const operationId = `thread-cleanup-fence:${createHash("sha256")
        .update(workSetId)
        .update("\0")
        .update(candidate.bindingKey)
        .digest("hex")}`;
      const existing =
        adoptExactFence(candidate, workSetId) ?? deps.ledger.read().fence;
      if (
        existing &&
        existing.operationId === operationId &&
        existing.destructiveKind === "manual-thread-cleanup" &&
        existing.retirementIntentId === workSetId &&
        existing.bindingKey === candidate.bindingKey &&
        existing.slot === candidate.slot &&
        targetKey(existing.target) === targetKey(candidate.target) &&
        existing.leaderEpoch === leaderEpoch &&
        existing.phase !== "fenced"
      ) {
        return { kind: "already-issued" };
      }
      let acquired;
      try {
        acquired = deps.ledger.acquireThreadCleanupFence({
          operationId,
          cleanupWorkSetId: workSetId,
          bindingKey: candidate.bindingKey,
          slot: candidate.slot,
          target: candidate.target,
          leaderEpoch,
          cleanupRequestedAtMs: now(),
        });
      } catch {
        return { kind: "blocked" };
      }
      if (acquired.kind === "blocked") return { kind: "blocked" };
      if (
        deps.getLeaderEpoch() !== leaderEpoch ||
        !(await deps.revalidateUnderFence(candidate))
      ) {
        if (acquired.fence.phase === "fenced")
          deps.ledger.releaseUnissuedThreadCleanupFence(acquired.fence);
        return { kind: "blocked" };
      }
      const issued = deps.ledger.issueThreadCleanupDeletionPermit(
        acquired.fence,
      );
      return issued.kind === "issued"
        ? { kind: "issued", fence: issued.fence, permit: issued.permit }
        : { kind: "already-issued" };
    },
    async settleDeleted(fence, commit) {
      const assertAuthority = () => {
        const owner = deps.getOwner();
        if (deps.getLeaderEpoch() !== fence.leaderEpoch ||
            owner.processId !== fence.owner.processId || owner.processBirthId !== fence.owner.processBirthId)
          throw new Error("Telegram Thread cleanup settlement authority changed.");
      };
      assertAuthority();
      const ready = deps.ledger.confirmThreadCleanupAbsence(fence);
      const committed = await commit();
      assertAuthority();
      if (!committed) return "commit-pending";
      deps.ledger.completeThreadCleanupFence(ready);
      return "completed";
    },
  };
}

export interface TelegramInactiveThreadCleanupCoordinatorDeps<TBinding> {
  store: TelegramThreadCleanupWorkStore;
  permitRuntime: ReturnType<typeof createTelegramThreadCleanupPermitRuntime>;
  resolveFullBinding(
    candidate: TelegramThreadCleanupCandidate,
  ): Promise<TBinding | undefined>;
  deleteWithPermit(
    permit: TelegramThreadCleanupDeletionPermit,
    candidate: TelegramThreadCleanupCandidate,
  ): Promise<void>;
  commitBinding(
    candidate: TelegramThreadCleanupCandidate,
    currentBinding?: TBinding,
  ): Promise<boolean>;
}

export interface TelegramInactiveThreadCleanupAuthority {
  profileName: string;
  leaderEpoch: number | string;
  ledger: TelegramWorkspaceAdmissionLedger;
  isCurrent(): boolean;
}

/** Review owns ordinary admission; confirmed cleanup uses the shared gate and its exclusive manual fence instead. */
export function createTelegramInactiveThreadCleanupRuntime(deps: {
  store: Pick<TelegramTopicTargetStore, "load" | "listWorkspaceBindings" | "listReservations" | "listPendingProvisions" | "listPendingCleanups" | "commitInactiveWorkspaceCleanup">;
  captureAuthority(): TelegramInactiveThreadCleanupAuthority | undefined;
  getWorkStore(authority: TelegramInactiveThreadCleanupAuthority): TelegramThreadCleanupWorkStore;
  getProtection(binding: TelegramWorkspaceThreadBinding): {
    liveOwner: TelegramThreadCleanupProtectionState;
    acceptedWork: TelegramThreadCleanupProtectionState;
    deliveryAuthority: TelegramThreadCleanupProtectionState;
  };
  getProcessLiveness(owner: TelegramWorkspaceAdmissionOwner): TelegramProcessLiveness;
  runExclusive<T>(operation: () => Promise<T>): Promise<T>;
  runWorkspaceOperation: TelegramWorkspaceOperationRunner;
  deleteThread: TelegramWorkspaceThreadDeletionTransport;
  onError?: (error: unknown) => void;
}): {
  review(): Promise<{ count: number; operationId?: string }>;
  clean(operationId: string): Promise<TelegramInactiveThreadCleanupResult>;
} {
  const capture = () => {
    const authority = deps.captureAuthority();
    if (!authority || !authority.isCurrent())
      throw new Error("Inactive Thread cleanup requires current leader authority.");
    const ledgerKey = authority.ledger.getProfileKey();
    const owner = authority.ledger.getOwner();
    const assertCurrent = () => {
      if (!authority.isCurrent() || authority.ledger.getProfileKey() !== ledgerKey)
        throw new Error("Inactive Thread cleanup authority changed.");
    };
    const evidence = () => {
      assertCurrent();
      return captureTelegramInactiveThreadCleanupEvidence({
        profileName: authority.profileName,
        listBindings: deps.store.listWorkspaceBindings,
        getProtection: deps.getProtection,
        listReservations: deps.store.listReservations,
        listPendingProvisions: deps.store.listPendingProvisions,
        listPendingCleanups: deps.store.listPendingCleanups,
      });
    };
    return { authority, owner, assertCurrent, evidence };
  };
  return {
    async review() {
      const scope = capture();
      return createTelegramInactiveThreadCleanupReviewRuntime({
        getProfileName: () => scope.authority.profileName,
        listBindings: deps.store.listWorkspaceBindings,
        getProtection: deps.getProtection,
        listReservations: deps.store.listReservations,
        listPendingProvisions: deps.store.listPendingProvisions,
        listPendingCleanups: deps.store.listPendingCleanups,
        getWorkStore() { scope.assertCurrent(); return deps.getWorkStore(scope.authority); },
        runWorkspaceOperation(metadata, operation) {
          return deps.runWorkspaceOperation(metadata, async () => {
            scope.assertCurrent();
            await deps.store.load();
            scope.assertCurrent();
            return operation();
          });
        },
      }).review();
    },
    async clean(operationId) {
      const scope = capture();
      return deps.runExclusive(async () => {
        scope.assertCurrent();
        const { authority } = scope;
        const work = deps.getWorkStore(authority);
        const exactBinding = (candidate: TelegramThreadCleanupCandidate) => {
          const fresh = planTelegramInactiveThreadCleanup(scope.evidence()).find(binding => binding.bindingKey === candidate.bindingKey);
          if (!fresh || !sameCandidates([fresh], [candidate])) return undefined;
          return deps.store.listWorkspaceBindings().find(binding => binding.bindingKey === fresh.bindingKey);
        };
        const loadExactBinding = async (candidate: TelegramThreadCleanupCandidate) => {
          scope.assertCurrent();
          await deps.store.load();
          scope.assertCurrent();
          return exactBinding(candidate);
        };
        const permitRuntime = createTelegramThreadCleanupPermitRuntime({
          ledger: authority.ledger,
          getLeaderEpoch: () => authority.isCurrent() ? authority.leaderEpoch : undefined,
          getProfileName: () => authority.profileName,
          getOwner: () => scope.owner,
          canAdoptFence: fence => authority.isCurrent() && deps.getProcessLiveness(fence.owner) === "dead",
          revalidateUnderFence: async candidate => !!(await loadExactBinding(candidate)),
        });
        return cleanReviewedInactiveThreads({
          store: work, operationId, permitRuntime,
          resolveFullBinding: loadExactBinding,
          async deleteWithPermit(permit, candidate) {
            try {
              await deps.deleteThread(() => {
                scope.assertCurrent();
                const fence = authority.ledger.read().fence;
                if (!fence || !isTelegramWorkspaceRetirementFence(fence) ||
                    fence.destructiveKind !== "manual-thread-cleanup" || fence.phase !== "deletion-issued" ||
                    fence.operationId !== permit.operationId || fence.retirementIntentId !== operationId ||
                    fence.profileKey !== permit.profileKey || fence.bindingKey !== candidate.bindingKey ||
                    fence.slot !== candidate.slot || fence.deletionIssuedAtMs !== permit.issuedAtMs ||
                    fence.leaderEpoch !== authority.leaderEpoch || fence.owner.processId !== scope.owner.processId ||
                    fence.owner.processBirthId !== scope.owner.processBirthId ||
                    targetKey(fence.target) !== targetKey(permit.target) || !exactBinding(candidate))
                  throw new Error("Inactive Thread cleanup deletion permit is stale.");
                return { ...permit.target };
              });
              scope.assertCurrent();
            } catch (error) {
              deps.onError?.(error);
              throw error;
            }
          },
          async commitBinding(candidate) {
            scope.assertCurrent();
            await deps.store.load();
            scope.assertCurrent();
            return deps.store.commitInactiveWorkspaceCleanup(candidate, authority.isCurrent);
          },
        });
      });
    },
  };
}

export function createTelegramInactiveThreadCleanupSettingsPort<TBinding>(
  deps: TelegramInactiveThreadCleanupCoordinatorDeps<TBinding>,
): (operationId: string) => Promise<TelegramInactiveThreadCleanupResult> {
  return (operationId) =>
    cleanReviewedInactiveThreads({ ...deps, operationId });
}

export interface TelegramInactiveThreadCleanupResult {
  deleted: number;
  outcomeUnknown: number;
  blocked: number;
  recovery?: "commit-ready" | "deletion-outcome-unknown" | "authority-blocked";
}

export async function cleanReviewedInactiveThreads<TBinding>(
  input: {
    operationId: string;
  } & TelegramInactiveThreadCleanupCoordinatorDeps<TBinding>,
): Promise<TelegramInactiveThreadCleanupResult> {
  if (!/^thread-cleanup:[a-f0-9]{32}$/u.test(input.operationId))
    throw new Error(
      "Telegram Thread cleanup confirmation identity is invalid.",
    );
  const workSet = input.store
    .list()
    .find((candidate) => candidate.operationId === input.operationId);
  if (!workSet) throw new Error("Telegram Thread cleanup review is missing.");
  let deleted = 0;
  let outcomeUnknown = 0;
  let blocked = 0;
  for (const entry of workSet.entries) {
    if (entry.state === "deleted") {
      const ready = input.permitRuntime.findCommitReady(
        entry,
        input.operationId,
      );
      if (ready) {
        const settlement = await input.permitRuntime.settleDeleted(ready, async () => true);
        if (settlement === "completed") deleted += 1;
        else outcomeUnknown += 1;
      } else if (input.permitRuntime.diagnoseRecovery(entry, input.operationId) !== "none") {
        outcomeUnknown += 1;
      } else deleted += 1;
      continue;
    }
    if (entry.state === "outcome-unknown") {
      const ready = input.permitRuntime.findCommitReady(
        entry,
        input.operationId,
      );
      if (!ready) {
        outcomeUnknown += 1;
        continue;
      }
      const settlement = await input.permitRuntime.settleDeleted(ready, () =>
        commitTelegramInactiveThreadCleanup({
          store: input.store,
          operationId: input.operationId,
          bindingKey: entry.bindingKey,
          commitBinding: () => input.commitBinding(entry),
        }),
      );
      if (settlement === "completed") deleted += 1;
      else outcomeUnknown += 1;
      continue;
    }
    const fullBinding = await input.resolveFullBinding(entry);
    if (!fullBinding) {
      blocked += 1;
      continue;
    }
    const authority = await input.permitRuntime.acquire(
      entry,
      input.operationId,
    );
    if (authority.kind === "blocked") {
      blocked += 1;
      continue;
    }
    if (authority.kind === "already-issued") {
      outcomeUnknown += 1;
      continue;
    }
    try {
      const recorded = input.store.recordDeletionIssued({
        operationId: input.operationId,
        bindingKey: entry.bindingKey,
        bindingUpdatedAtMs: entry.bindingUpdatedAtMs,
        permit: authority.permit,
      });
      if (!recorded.recorded) {
        if (recorded.entry.state === "deleted") {
          const settlement = await input.permitRuntime.settleDeleted(
            authority.fence,
            async () => true,
          );
          if (settlement === "completed") deleted += 1;
          else outcomeUnknown += 1;
        } else outcomeUnknown += 1;
        continue;
      }
      await input.deleteWithPermit(authority.permit, entry);
      const settlement = await input.permitRuntime.settleDeleted(
        authority.fence,
        () =>
          commitTelegramInactiveThreadCleanup({
            store: input.store,
            operationId: input.operationId,
            bindingKey: entry.bindingKey,
            commitBinding: () => input.commitBinding(entry, fullBinding),
          }),
      );
      if (settlement === "completed") deleted += 1;
      else outcomeUnknown += 1;
    } catch {
      outcomeUnknown += 1;
    }
  }
  const retainedEntries =
    input.store
      .list()
      .find((candidate) => candidate.operationId === input.operationId)
      ?.entries ?? [];
  if (outcomeUnknown > 0) {
    const diagnosis =
      retainedEntries
        .map((entry) =>
          input.permitRuntime.diagnoseRecovery(entry, input.operationId),
        )
        .find((value) => value !== "none") ?? "none";
    const recovery =
      diagnosis === "commit-ready"
        ? "commit-ready"
        : diagnosis === "deletion-issued"
          ? "deletion-outcome-unknown"
          : "authority-blocked";
    return { deleted, outcomeUnknown, blocked, recovery };
  }
  return { deleted, outcomeUnknown, blocked };
}

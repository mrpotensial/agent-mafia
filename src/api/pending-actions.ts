import type { ActionType, ActionContext } from "../types.js";

export interface PendingAction {
  gameId: string;
  playerId: string;
  actionType: ActionType;
  context: ActionContext;
  resolve: (value: string | null) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
  createdAt: number;
}

/** Key: `${gameId}:${playerId}` */
const pendingActions = new Map<string, PendingAction>();

function makeKey(gameId: string, playerId: string): string {
  return `${gameId}:${playerId}`;
}

/**
 * Create a pending action that waits for external player input.
 * Returns a Promise that resolves when the player submits via HTTP or timeout fires.
 */
export function createPendingAction(
  gameId: string,
  playerId: string,
  actionType: ActionType,
  context: ActionContext,
  timeoutMs: number,
  fallbackFn: () => string | null,
): Promise<string | null> {
  return new Promise((resolve) => {
    const key = makeKey(gameId, playerId);

    const timeoutHandle = setTimeout(() => {
      const action = pendingActions.get(key);
      if (action) {
        pendingActions.delete(key);
        console.log(
          `[PendingAction] Timeout for ${playerId} in ${gameId} (${actionType}), using fallback`,
        );
        resolve(fallbackFn());
      }
    }, timeoutMs);

    pendingActions.set(key, {
      gameId,
      playerId,
      actionType,
      context,
      resolve,
      timeoutHandle,
      createdAt: Date.now(),
    });
  });
}

/**
 * Resolve a pending action with a value submitted by the external player.
 * Returns true if resolved, false if no pending action found.
 */
export function resolvePendingAction(
  gameId: string,
  playerId: string,
  value: string | null,
): boolean {
  const key = makeKey(gameId, playerId);
  const action = pendingActions.get(key);
  if (!action) return false;

  clearTimeout(action.timeoutHandle);
  pendingActions.delete(key);
  action.resolve(value);
  return true;
}

/** Get a pending action for a specific player. */
export function getPendingAction(
  gameId: string,
  playerId: string,
): PendingAction | undefined {
  return pendingActions.get(makeKey(gameId, playerId));
}

/** Get all pending actions for a game. */
export function getGamePendingActions(gameId: string): PendingAction[] {
  const result: PendingAction[] = [];
  for (const [, action] of pendingActions) {
    if (action.gameId === gameId) result.push(action);
  }
  return result;
}

/** Clear all pending actions for a game (on game end). */
export function clearGamePendingActions(gameId: string): void {
  for (const [key, action] of pendingActions) {
    if (action.gameId === gameId) {
      clearTimeout(action.timeoutHandle);
      pendingActions.delete(key);
    }
  }
}

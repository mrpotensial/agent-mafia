import type { GameEvent } from "../types.js";

export type GameEventListener = (event: GameEvent) => void;

export class GameEventEmitter {
  private listeners: GameEventListener[] = [];
  private history: GameEvent[] = [];

  on(listener: GameEventListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  emit(event: GameEvent): void {
    this.history.push(event);
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error("[EventEmitter] Listener error:", err);
      }
    }
  }

  getHistory(): GameEvent[] {
    return [...this.history];
  }

  clear(): void {
    this.listeners = [];
    this.history = [];
  }
}

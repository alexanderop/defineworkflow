import type { AgentKey } from "./brand.js";

export interface AgentControl {
  // Lookup side: the key originates from the UI (a plain string the user navigated to), so it
  // stays unbranded — symmetric to looking a run up by its argv string.
  stopAgent(key: string): void;
  restartAgent(key: string): void;
}

export interface ControlRegistry extends AgentControl {
  // Mint side: only the runtime registers, and only with the freshly-minted composite AgentKey.
  register(key: AgentKey, controller: AbortController, requestRestart: () => void): () => void;
}

export function createControlRegistry(): ControlRegistry {
  const map = new Map<string, { controller: AbortController; requestRestart: () => void }>();
  return {
    register(key, controller, requestRestart) {
      map.set(key, { controller, requestRestart });
      return () => {
        if (map.get(key)?.controller === controller) map.delete(key);
      };
    },
    stopAgent(key) {
      const e = map.get(key);
      if (e) e.controller.abort();
    },
    restartAgent(key) {
      const e = map.get(key);
      if (e) {
        e.requestRestart();
        e.controller.abort();
      }
    },
  };
}

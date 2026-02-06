import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: PluginRuntime | null = null;

export function setKookRuntime(next: PluginRuntime): void {
  runtime = next;
}

export function getKookRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("KOOK runtime not initialized - plugin not registered");
  }
  return runtime;
}

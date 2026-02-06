import type { KookProbeResult } from "../types.js";
import { getBotInfo, type KookApiOptions } from "./client.js";

/** Probe the Kook bot to verify credentials are valid. */
export async function probeKook(opts?: KookApiOptions): Promise<KookProbeResult> {
  if (!opts?.token) {
    return { ok: false, error: "missing credentials (token)" };
  }

  try {
    const res = await getBotInfo(opts);
    if (res.code !== 0) {
      return {
        ok: false,
        error: `API error: ${res.message || `code ${res.code}`}`,
      };
    }

    return {
      ok: true,
      botId: res.data.id,
      botName: res.data.username,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

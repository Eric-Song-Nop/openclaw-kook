import type { ClawdbotConfig, RuntimeEnv, HistoryEntry } from "openclaw/plugin-sdk";
import type { KookEventData, KookSignalFrame, ResolvedKookAccount } from "../types.js";
import { resolveKookAccount } from "../accounts.js";
import { handleKookMessage } from "../bot.js";
import { getGateway, getBotInfo, type KookApiOptions } from "./client.js";

export type MonitorKookOpts = {
  config?: ClawdbotConfig;
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
  accountId?: string;
};

const HEARTBEAT_INTERVAL_MS = 30_000;
const HELLO_TIMEOUT_MS = 6_000;
const RECONNECT_BASE_MS = 2_000;
const MAX_RECONNECT_WAIT_MS = 60_000;

async function fetchBotId(opts: KookApiOptions): Promise<string | undefined> {
  try {
    const res = await getBotInfo(opts);
    return res.code === 0 ? res.data.id : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Connect to the Kook WebSocket gateway and process incoming events.
 */
async function connectWebSocket(params: {
  cfg: ClawdbotConfig;
  account: ResolvedKookAccount;
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
}): Promise<void> {
  const { cfg, account, runtime, abortSignal } = params;
  const { accountId } = account;
  const log = runtime?.log ?? console.log;
  const logError = runtime?.error ?? console.error;

  if (!account.token) {
    throw new Error(`KOOK account "${accountId}" has no token`);
  }

  const apiOpts: KookApiOptions = { token: account.token };

  // Resolve bot ID so we can filter self-messages
  const botId = await fetchBotId(apiOpts);
  log(`kook[${accountId}]: bot ID resolved: ${botId ?? "unknown"}`);

  const chatHistories = new Map<string, HistoryEntry[]>();
  let sn = 0;
  let sessionId = "";
  let reconnectAttempt = 0;

  const connect = async (): Promise<void> => {
    if (abortSignal?.aborted) {
      return;
    }

    // Step 1: Get gateway URL
    log(`kook[${accountId}]: fetching gateway URL...`);
    const gwRes = await getGateway(apiOpts, 0); // compress=0 for plain text
    if (gwRes.code !== 0) {
      throw new Error(`Failed to get KOOK gateway: ${gwRes.message || `code ${gwRes.code}`}`);
    }

    const gatewayUrl = gwRes.data.url;
    log(`kook[${accountId}]: connecting to gateway...`);

    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(gatewayUrl);
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
      let helloTimer: ReturnType<typeof setTimeout> | null = null;
      let resolved = false;

      const cleanup = () => {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
        if (helloTimer) {
          clearTimeout(helloTimer);
          helloTimer = null;
        }
        try {
          ws.close();
        } catch {
          // ignore close errors
        }
      };

      const handleAbort = () => {
        log(`kook[${accountId}]: abort signal received, closing WebSocket`);
        cleanup();
        if (!resolved) {
          resolved = true;
          resolve();
        }
      };

      if (abortSignal?.aborted) {
        cleanup();
        resolve();
        return;
      }

      abortSignal?.addEventListener("abort", handleAbort, { once: true });

      // Set hello timeout - must receive hello within 6s
      helloTimer = setTimeout(() => {
        log(`kook[${accountId}]: hello timeout, reconnecting...`);
        cleanup();
        abortSignal?.removeEventListener("abort", handleAbort);
        if (!resolved) {
          resolved = true;
          scheduleReconnect().then(resolve, reject);
        }
      }, HELLO_TIMEOUT_MS);

      ws.addEventListener("open", () => {
        log(`kook[${accountId}]: WebSocket connected`);
        reconnectAttempt = 0;
      });

      ws.addEventListener("message", (wsEvent) => {
        try {
          const frame = JSON.parse(String(wsEvent.data)) as KookSignalFrame;

          switch (frame.s) {
            case 1: {
              // Hello - connection acknowledged
              if (helloTimer) {
                clearTimeout(helloTimer);
                helloTimer = null;
              }
              const helloData = frame.d;
              sessionId = (helloData.session_id as string) ?? sessionId;
              log(`kook[${accountId}]: hello received, session=${sessionId}`);

              // Start heartbeat
              heartbeatTimer = setInterval(() => {
                try {
                  ws.send(JSON.stringify({ s: 2, sn }));
                } catch (err) {
                  logError(`kook[${accountId}]: heartbeat send failed: ${String(err)}`);
                }
              }, HEARTBEAT_INTERVAL_MS);
              break;
            }

            case 0: {
              // Event dispatch
              if (typeof frame.sn === "number") {
                sn = frame.sn;
              }
              const eventData = frame.d as unknown as KookEventData;

              // Skip messages from the bot itself
              if (botId && eventData.author_id === botId) {
                break;
              }
              // Skip system events (type 255)
              if (eventData.type === 255) {
                break;
              }

              // Only handle text-like messages (1=text, 9=kmarkdown, 10=card)
              if (eventData.type !== 1 && eventData.type !== 9 && eventData.type !== 10) {
                break;
              }

              void handleKookMessage({
                cfg,
                event: eventData,
                botId,
                runtime,
                chatHistories,
                accountId,
              }).catch((err) => {
                logError(`kook[${accountId}]: error handling message: ${String(err)}`);
              });
              break;
            }

            case 3: {
              // Pong - heartbeat acknowledged
              break;
            }

            case 5: {
              // Reconnect request from server
              log(`kook[${accountId}]: server requested reconnect`);
              sn = 0;
              sessionId = "";
              cleanup();
              abortSignal?.removeEventListener("abort", handleAbort);
              if (!resolved) {
                resolved = true;
                scheduleReconnect().then(resolve, reject);
              }
              break;
            }

            case 6: {
              // Resume ACK
              const resumeData = frame.d;
              sessionId = (resumeData.session_id as string) ?? sessionId;
              log(`kook[${accountId}]: resume acknowledged, session=${sessionId}`);
              break;
            }
          }
        } catch (err) {
          logError(`kook[${accountId}]: failed to parse WebSocket message: ${String(err)}`);
        }
      });

      ws.addEventListener("close", (closeEvent) => {
        log(`kook[${accountId}]: WebSocket closed (code=${closeEvent.code})`);
        cleanup();
        abortSignal?.removeEventListener("abort", handleAbort);
        if (!resolved && !abortSignal?.aborted) {
          resolved = true;
          scheduleReconnect().then(resolve, reject);
        } else if (!resolved) {
          resolved = true;
          resolve();
        }
      });

      ws.addEventListener("error", () => {
        logError(`kook[${accountId}]: WebSocket error`);
      });
    });
  };

  const scheduleReconnect = async (): Promise<void> => {
    if (abortSignal?.aborted) {
      return;
    }
    reconnectAttempt++;
    const waitMs = Math.min(RECONNECT_BASE_MS * 2 ** (reconnectAttempt - 1), MAX_RECONNECT_WAIT_MS);
    log(`kook[${accountId}]: reconnecting in ${waitMs}ms (attempt ${reconnectAttempt})`);
    await new Promise((r) => setTimeout(r, waitMs));
    if (abortSignal?.aborted) {
      return;
    }
    return connect();
  };

  return connect();
}

/**
 * Monitor a single Kook account.
 */
async function monitorSingleAccount(params: {
  cfg: ClawdbotConfig;
  account: ResolvedKookAccount;
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
}): Promise<void> {
  const { cfg, account, runtime, abortSignal } = params;
  const log = runtime?.log ?? console.log;

  log(`kook[${account.accountId}]: starting WebSocket connection...`);
  return connectWebSocket({ cfg, account, runtime, abortSignal });
}

/**
 * Main entry: start monitoring for all enabled accounts.
 */
export async function monitorKookProvider(opts: MonitorKookOpts = {}): Promise<void> {
  const cfg = opts.config;
  if (!cfg) {
    throw new Error("Config is required for KOOK monitor");
  }

  const log = opts.runtime?.log ?? console.log;

  if (opts.accountId) {
    const account = resolveKookAccount({ cfg, accountId: opts.accountId });
    if (!account.enabled || !account.configured) {
      throw new Error(`KOOK account "${opts.accountId}" not configured or disabled`);
    }
    return monitorSingleAccount({
      cfg,
      account,
      runtime: opts.runtime,
      abortSignal: opts.abortSignal,
    });
  }

  // Monitor all enabled accounts
  const { listEnabledKookAccounts } = await import("../accounts.js");
  const accounts = listEnabledKookAccounts(cfg);
  if (accounts.length === 0) {
    log("kook: no enabled accounts found");
    return;
  }

  log(`kook: starting ${accounts.length} account(s)`);
  await Promise.all(
    accounts.map((account) =>
      monitorSingleAccount({
        cfg,
        account,
        runtime: opts.runtime,
        abortSignal: opts.abortSignal,
      }),
    ),
  );
}

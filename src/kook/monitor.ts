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

// 心跳配置（符合 KOOK 官方规范：30±5 秒随机间隔）
const HEARTBEAT_BASE_INTERVAL_MS = 30_000;
const HEARTBEAT_RANDOM_RANGE_MS = 5_000;
const PONG_TIMEOUT_MS = 6_000; // pong 超时时间
const HELLO_TIMEOUT_MS = 6_000;
const RECONNECT_BASE_MS = 2_000;
const MAX_RECONNECT_WAIT_MS = 60_000;

// 心跳健康度监控配置
const HEARTBEAT_HISTORY_SIZE = 10; // 保存最近 N 次心跳记录

/**
 * 心跳健康度统计数据
 */
interface HeartbeatStats {
  totalSent: number;        // 总发送次数
  totalReceived: number;    // 总接收次数
  totalTimeout: number;     // 总超时次数
  recentRtt: number[];      // 最近 N 次 RTT（往返时间，毫秒）
  lastPingTime: number;     // 最后一次 ping 发送时间
  lastPongTime: number;     // 最后一次 pong 接收时间
}

/**
 * 创建新的心跳统计数据
 */
function createHeartbeatStats(): HeartbeatStats {
  return {
    totalSent: 0,
    totalReceived: 0,
    totalTimeout: 0,
    recentRtt: [],
    lastPingTime: 0,
    lastPongTime: 0,
  };
}

/**
 * 记录心跳 ping 发送
 */
function recordPingSent(stats: HeartbeatStats): void {
  stats.totalSent++;
  stats.lastPingTime = Date.now();
}

/**
 * 记录心跳 pong 接收并计算 RTT
 */
function recordPongReceived(stats: HeartbeatStats): number | null {
  stats.totalReceived++;
  const now = Date.now();
  const rtt = now - stats.lastPingTime;
  stats.lastPongTime = now;

  // 保存到历史记录（只保留最近 N 次）
  stats.recentRtt.push(rtt);
  if (stats.recentRtt.length > HEARTBEAT_HISTORY_SIZE) {
    stats.recentRtt.shift();
  }

  return rtt;
}

/**
 * 记录心跳超时
 */
function recordPongTimeout(stats: HeartbeatStats): void {
  stats.totalTimeout++;
}

/**
 * 计算平均 RTT
 */
function getAverageRtt(stats: HeartbeatStats): number {
  if (stats.recentRtt.length === 0) return 0;
  const sum = stats.recentRtt.reduce((a, b) => a + b, 0);
  return Math.round(sum / stats.recentRtt.length);
}

/**
 * 生成随机心跳间隔（25-35 秒，符合 KOOK 官方规范）
 */
function getRandomHeartbeatInterval(): number {
  const randomOffset = (Math.random() * 2 - 1) * HEARTBEAT_RANDOM_RANGE_MS;
  return HEARTBEAT_BASE_INTERVAL_MS + randomOffset;
}

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
  const heartbeatStats = createHeartbeatStats(); // 心跳健康度统计

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
      let pongTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
      let helloTimer: ReturnType<typeof setTimeout> | null = null;
      let resolved = false;

      const cleanup = () => {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
        if (pongTimeoutTimer) {
          clearTimeout(pongTimeoutTimer);
          pongTimeoutTimer = null;
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

      /**
       * 发送心跳 ping 并启动超时检测
       */
      const sendHeartbeat = () => {
        try {
          // 记录 ping 发送
          recordPingSent(heartbeatStats);

          // 发送心跳 ping
          ws.send(JSON.stringify({ s: 2, sn }));

          // 记录 ping 发送日志
          log(`kook[${accountId}]: ping sent, sn=${sn}`);

          // 启动 pong 超时检测（6 秒）
          if (pongTimeoutTimer) {
            clearTimeout(pongTimeoutTimer);
          }
          pongTimeoutTimer = setTimeout(() => {
            // pong 超时，记录并主动断开连接
            recordPongTimeout(heartbeatStats);
            logError(
              `kook[${accountId}]: pong timeout (${PONG_TIMEOUT_MS}ms), ` +
              `stats: sent=${heartbeatStats.totalSent}, ` +
              `received=${heartbeatStats.totalReceived}, ` +
              `timeouts=${heartbeatStats.totalTimeout}, ` +
              `avgRtt=${getAverageRtt(heartbeatStats)}ms`
            );
            cleanup();
            abortSignal?.removeEventListener("abort", handleAbort);
            if (!resolved) {
              resolved = true;
              scheduleReconnect().then(resolve, reject);
            }
          }, PONG_TIMEOUT_MS);
        } catch (err) {
          logError(`kook[${accountId}]: heartbeat send failed: ${String(err)}`);
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

              // 启动心跳（使用随机间隔，符合 KOOK 官方规范）
              const startHeartbeat = () => {
                const interval = getRandomHeartbeatInterval();
                log(`kook[${accountId}]: heartbeat started (interval=${Math.round(interval / 1000)}s)`);
                heartbeatTimer = setInterval(() => {
                  sendHeartbeat();
                }, interval);
              };

              // 立即发送第一次心跳
              sendHeartbeat();
              // 然后启动定时心跳
              startHeartbeat();
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
              if (pongTimeoutTimer) {
                clearTimeout(pongTimeoutTimer);
                pongTimeoutTimer = null;
              }

              const rtt = recordPongReceived(heartbeatStats);
              if (rtt !== null) {
                const avgRtt = getAverageRtt(heartbeatStats);
                log(
                  `kook[${accountId}]: pong received, sn=${sn}, rtt=${rtt}ms, ` +
                  `avgRtt=${avgRtt}ms, stats: sent=${heartbeatStats.totalSent}, ` +
                  `received=${heartbeatStats.totalReceived}, timeouts=${heartbeatStats.totalTimeout}`
                );
              }
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

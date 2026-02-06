import type { ChannelPlugin } from "openclaw/plugin-sdk";
import { DEFAULT_ACCOUNT_ID, PAIRING_APPROVED_MESSAGE } from "openclaw/plugin-sdk";
import type { ResolvedKookAccount } from "./types.js";
import {
  resolveKookAccount,
  listKookAccountIds,
  resolveDefaultKookAccountId,
  normalizeKookAccountId,
} from "./accounts.js";
import { probeKook } from "./kook/probe.js";
import { sendMessageKook } from "./kook/send.js";
import { kookOutbound } from "./outbound.js";
import { getKookRuntime } from "./runtime.js";

const meta = {
  id: "kook",
  label: "KOOK",
  selectionLabel: "KOOK (开黑啦)",
  docsPath: "/channels/kook",
  docsLabel: "kook",
  blurb: "KOOK bot for Chinese gaming communities.",
  order: 76,
} as const;

export const kookPlugin: ChannelPlugin<ResolvedKookAccount> = {
  id: "kook",
  meta: {
    ...meta,
    quickstartAllowFrom: true,
  },

  pairing: {
    idLabel: "kookUserId",
    normalizeAllowEntry: (entry) => entry.replace(/^kook:(?:user:)?/i, ""),
    notifyApproval: async ({ cfg, id, accountId }) => {
      await sendMessageKook({
        cfg,
        to: `user:${id}`,
        text: PAIRING_APPROVED_MESSAGE,
        accountId,
        isDm: true,
      });
    },
  },

  capabilities: {
    chatTypes: ["direct", "group"],
    reactions: true,
    threads: false,
    media: true,
    nativeCommands: false,
    blockStreaming: true,
  },

  agentPrompt: {
    messageToolHints: () => [
      "- KOOK targeting: omit `target` to reply to the current conversation (auto-inferred). Explicit targets: `channel:<channelId>` or `user:<userId>`.",
      "- KOOK supports KMarkdown for rich text formatting.",
    ],
  },

  reload: { configPrefixes: ["channels.kook"] },

  configSchema: {
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        enabled: { type: "boolean" },
        token: { type: "string" },
        name: { type: "string" },
        dmPolicy: { type: "string", enum: ["open", "pairing", "allowlist"] },
        allowFrom: { type: "array", items: { type: "string" } },
        groupPolicy: { type: "string", enum: ["open", "allowlist", "disabled"] },
        groupAllowFrom: { type: "array", items: { type: "string" } },
        requireMention: { type: "boolean" },
        textChunkLimit: { type: "integer", minimum: 1 },
        groups: {
          type: "object",
          additionalProperties: {
            type: "object",
            properties: {
              enabled: { type: "boolean" },
              requireMention: { type: "boolean" },
              allowFrom: { type: "array", items: { type: "string" } },
            },
          },
        },
        accounts: {
          type: "object",
          additionalProperties: {
            type: "object",
            properties: {
              enabled: { type: "boolean" },
              name: { type: "string" },
              token: { type: "string" },
              dmPolicy: { type: "string", enum: ["open", "pairing", "allowlist"] },
              allowFrom: { type: "array", items: { type: "string" } },
              groupPolicy: { type: "string", enum: ["open", "allowlist", "disabled"] },
              groupAllowFrom: { type: "array", items: { type: "string" } },
              requireMention: { type: "boolean" },
              textChunkLimit: { type: "integer", minimum: 1 },
            },
          },
        },
      },
    },
  },

  config: {
    listAccountIds: (cfg) => listKookAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveKookAccount({ cfg, accountId }),
    defaultAccountId: (cfg) => resolveDefaultKookAccountId(cfg),

    setAccountEnabled: ({ cfg, accountId, enabled }) => {
      const kookCfg = (cfg.channels?.kook ?? {}) as Record<string, unknown>;

      if (accountId === DEFAULT_ACCOUNT_ID) {
        return {
          ...cfg,
          channels: {
            ...cfg.channels,
            kook: { ...kookCfg, enabled },
          },
        };
      }

      const accounts = (kookCfg.accounts ?? {}) as Record<string, Record<string, unknown>>;
      return {
        ...cfg,
        channels: {
          ...cfg.channels,
          kook: {
            ...kookCfg,
            accounts: {
              ...accounts,
              [accountId]: { ...accounts[accountId], enabled },
            },
          },
        },
      };
    },

    deleteAccount: ({ cfg, accountId }) => {
      const kookCfg = { ...((cfg.channels?.kook ?? {}) as Record<string, unknown>) };

      if (accountId === DEFAULT_ACCOUNT_ID) {
        delete kookCfg.token;
        delete kookCfg.enabled;
        return {
          ...cfg,
          channels: { ...cfg.channels, kook: kookCfg },
        };
      }

      const accounts = { ...((kookCfg.accounts ?? {}) as Record<string, unknown>) };
      delete accounts[accountId];
      return {
        ...cfg,
        channels: { ...cfg.channels, kook: { ...kookCfg, accounts } },
      };
    },

    isConfigured: (account) => account.configured,

    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
      tokenSource: account.tokenSource,
    }),

    resolveAllowFrom: ({ cfg, accountId }) => {
      const account = resolveKookAccount({ cfg, accountId });
      const raw = account.config.allowFrom;
      if (!raw) {
        return undefined;
      }
      return raw.map(String);
    },

    formatAllowFrom: ({ allowFrom }) => {
      return allowFrom.map((entry) => String(entry).replace(/^kook:(?:user:)?/i, ""));
    },
  },

  security: {
    resolveDmPolicy: ({ account }) => {
      const dmPolicy = account.config.dmPolicy ?? "pairing";
      return {
        policy: dmPolicy,
        settingsPath: `channels.kook.dmPolicy`,
        approvalHint: `openclaw config set channels.kook.allowFrom '["<userId>"]'`,
      };
    },
    collectWarnings: ({ account }) => {
      const warnings: Array<{ level: "warn" | "info"; message: string }> = [];
      if (account.config.groupPolicy === "open") {
        warnings.push({
          level: "warn",
          message:
            "KOOK groupPolicy is 'open' — any guild/channel can message the bot. Consider using 'allowlist'.",
        });
      }
      return warnings;
    },
  },

  groups: {
    resolveRequireMention: ({ cfg, accountId, groupId }) => {
      const account = resolveKookAccount({ cfg, accountId });
      const groups = account.config.groups;
      if (!groups) {
        return true;
      }
      const groupConfig = groups[groupId] ?? groups["*"];
      return groupConfig?.requireMention ?? account.config.requireMention ?? true;
    },
  },

  messaging: {
    normalizeTarget: (target) => {
      const trimmed = target.trim();
      if (!trimmed) {
        return null;
      }
      return trimmed
        .replace(/^kook:(channel|user|dm|group):/i, "")
        .replace(/^kook:/i, "")
        .replace(/^(channel|user|dm|group):/i, "");
    },
    targetResolver: {
      looksLikeId: (id) => {
        const trimmed = id.trim();
        // Kook IDs are numeric strings or prefixed
        return /^\d{5,}$/.test(trimmed) || /^(kook|channel|user):/i.test(trimmed);
      },
      hint: "<channelId|userId>",
    },
  },

  directory: {
    self: async () => null,
    listPeers: async () => [],
    listGroups: async () => [],
  },

  setup: {
    resolveAccountId: ({ accountId }) => normalizeKookAccountId(accountId),

    applyAccountName: ({ cfg, accountId, name }) => {
      const kookCfg = (cfg.channels?.kook ?? {}) as Record<string, unknown>;
      if (accountId === DEFAULT_ACCOUNT_ID) {
        return {
          ...cfg,
          channels: { ...cfg.channels, kook: { ...kookCfg, name } },
        };
      }
      const accounts = (kookCfg.accounts ?? {}) as Record<string, Record<string, unknown>>;
      return {
        ...cfg,
        channels: {
          ...cfg.channels,
          kook: {
            ...kookCfg,
            accounts: {
              ...accounts,
              [accountId]: { ...accounts[accountId], name },
            },
          },
        },
      };
    },

    validateInput: ({ input }) => {
      if (!input?.token?.trim()) {
        return "Bot token is required. Create one at https://developer.kookapp.cn";
      }
      return null;
    },

    applyAccountConfig: ({ cfg, accountId, input }) => {
      const token = input?.token?.trim();
      const kookCfg = (cfg.channels?.kook ?? {}) as Record<string, unknown>;

      if (accountId === DEFAULT_ACCOUNT_ID) {
        return {
          ...cfg,
          channels: {
            ...cfg.channels,
            kook: { ...kookCfg, token, enabled: true },
          },
        };
      }

      const accounts = (kookCfg.accounts ?? {}) as Record<string, Record<string, unknown>>;
      return {
        ...cfg,
        channels: {
          ...cfg.channels,
          kook: {
            ...kookCfg,
            accounts: {
              ...accounts,
              [accountId]: { ...accounts[accountId], token, enabled: true },
            },
          },
        },
      };
    },
  },

  outbound: kookOutbound,

  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },

    collectStatusIssues: (accounts) => {
      const issues: Array<{ level: "error" | "warn"; message: string }> = [];
      for (const account of accounts) {
        if (!account.configured) {
          issues.push({
            level: "error",
            message: `KOOK account "${account.accountId}" is missing a bot token.`,
          });
        }
      }
      return issues;
    },

    probeAccount: async ({ account }) => {
      if (!account.token) {
        return { ok: false, error: "no token" };
      }
      return probeKook({ token: account.token });
    },

    buildAccountSnapshot: ({ account, runtime, probe }) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
      running: runtime?.running ?? false,
      botName: probe?.botName,
      botId: probe?.botId,
    }),
  },

  gateway: {
    startAccount: async (ctx) => {
      const { monitorKookProvider } = await import("./kook/monitor.js");
      ctx.log?.info(`starting kook[${ctx.accountId}]`);
      return monitorKookProvider({
        config: ctx.cfg,
        runtime: ctx.runtime,
        abortSignal: ctx.abortSignal,
        accountId: ctx.accountId,
      });
    },

    logoutAccount: async ({ accountId, cfg }) => {
      const core = getKookRuntime();
      const kookCfg = { ...((cfg.channels?.kook ?? {}) as Record<string, unknown>) };

      if (accountId === DEFAULT_ACCOUNT_ID) {
        delete kookCfg.token;
        const newCfg = {
          ...cfg,
          channels: { ...cfg.channels, kook: kookCfg },
        };
        await core.config.writeConfigFile(newCfg);
        return {
          cleared: ["token"],
          envToken: Boolean(process.env.KOOK_BOT_TOKEN),
          loggedOut: true,
        };
      }

      const accounts = { ...((kookCfg.accounts ?? {}) as Record<string, Record<string, unknown>>) };
      if (accounts[accountId]) {
        delete accounts[accountId].token;
        const newCfg = {
          ...cfg,
          channels: { ...cfg.channels, kook: { ...kookCfg, accounts } },
        };
        await core.config.writeConfigFile(newCfg);
      }

      return { cleared: ["token"], envToken: false, loggedOut: true };
    },
  },
};

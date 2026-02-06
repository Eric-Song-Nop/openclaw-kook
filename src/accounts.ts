import type { ClawdbotConfig } from "openclaw/plugin-sdk";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "openclaw/plugin-sdk";
import type { KookConfig, ResolvedKookAccount } from "./types.js";

function getKookConfig(cfg: ClawdbotConfig): KookConfig | undefined {
  return cfg.channels?.kook as KookConfig | undefined;
}

function listConfiguredAccountIds(cfg: ClawdbotConfig): string[] {
  const kookCfg = getKookConfig(cfg);
  if (!kookCfg?.accounts) {
    return [];
  }
  return Object.keys(kookCfg.accounts);
}

export function listKookAccountIds(cfg: ClawdbotConfig): string[] {
  const ids = listConfiguredAccountIds(cfg);
  if (ids.length === 0) {
    return [DEFAULT_ACCOUNT_ID];
  }
  return [...ids].toSorted((a, b) => a.localeCompare(b));
}

export function resolveDefaultKookAccountId(cfg: ClawdbotConfig): string {
  const ids = listConfiguredAccountIds(cfg);
  return ids.length > 0 ? ids[0] : DEFAULT_ACCOUNT_ID;
}

function mergeKookAccountConfig(cfg: ClawdbotConfig, accountId: string): KookConfig {
  const kookCfg = getKookConfig(cfg) ?? ({} as KookConfig);
  if (accountId === DEFAULT_ACCOUNT_ID) {
    return kookCfg;
  }

  const accountOverride = kookCfg.accounts?.[accountId];
  if (!accountOverride) {
    return kookCfg;
  }

  return { ...kookCfg, ...accountOverride, accounts: undefined };
}

function resolveKookToken(merged: KookConfig): { token?: string; source?: "config" | "env" } {
  // Check config first
  if (merged.token?.trim()) {
    return { token: merged.token.trim(), source: "config" };
  }
  // Fall back to env var
  const envToken = process.env.KOOK_BOT_TOKEN?.trim();
  if (envToken) {
    return { token: envToken, source: "env" };
  }
  return {};
}

export function resolveKookAccount(params: {
  cfg: ClawdbotConfig;
  accountId?: string | null;
}): ResolvedKookAccount {
  const accountId = normalizeAccountId(params.accountId);
  const kookCfg = getKookConfig(params.cfg);

  const baseEnabled = kookCfg?.enabled !== false;
  const merged = mergeKookAccountConfig(params.cfg, accountId);
  const accountEnabled = merged.enabled !== false;
  const enabled = baseEnabled && accountEnabled;

  const { token, source } = resolveKookToken(merged);

  return {
    accountId,
    enabled,
    configured: Boolean(token),
    name: (merged as Record<string, unknown>).name as string | undefined,
    token,
    tokenSource: source,
    config: merged,
  };
}

export function listEnabledKookAccounts(cfg: ClawdbotConfig): ResolvedKookAccount[] {
  return listKookAccountIds(cfg)
    .map((accountId) => resolveKookAccount({ cfg, accountId }))
    .filter((account) => account.enabled && account.configured);
}

export function normalizeKookAccountId(accountId?: string | null): string {
  return normalizeAccountId(accountId);
}

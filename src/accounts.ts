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
  return Object.keys(kookCfg.accounts).map(normalizeAccountId);
}

export function listKookAccountIds(cfg: ClawdbotConfig): string[] {
  const ids = listConfiguredAccountIds(cfg);
  return [DEFAULT_ACCOUNT_ID, ...ids].toSorted((a, b) => a.localeCompare(b));
}

export function resolveDefaultKookAccountId(_cfg: ClawdbotConfig): string {
  return DEFAULT_ACCOUNT_ID;
}

function findAccountOverride(kookCfg: KookConfig, normalizedId: string) {
  if (!kookCfg.accounts) return undefined;
  // Try direct lookup first
  if (kookCfg.accounts[normalizedId]) return kookCfg.accounts[normalizedId];
  // Fall back to normalized key scan
  for (const [key, value] of Object.entries(kookCfg.accounts)) {
    if (normalizeAccountId(key) === normalizedId) return value;
  }
  return undefined;
}

function mergeKookAccountConfig(cfg: ClawdbotConfig, accountId: string): KookConfig {
  const kookCfg = getKookConfig(cfg) ?? ({} as KookConfig);
  if (accountId === DEFAULT_ACCOUNT_ID) {
    return kookCfg;
  }

  const accountOverride = findAccountOverride(kookCfg, accountId);
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

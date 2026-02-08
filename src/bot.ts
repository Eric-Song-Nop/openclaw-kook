import type { ClawdbotConfig, RuntimeEnv, AckReactionScope } from "openclaw/plugin-sdk";
import {
  buildPendingHistoryContextFromMap,
  recordPendingHistoryEntryIfEnabled,
  clearHistoryEntriesIfEnabled,
  DEFAULT_GROUP_HISTORY_LIMIT,
  resolveAckReaction,
  shouldAckReaction as shouldAckReactionGate,
  removeAckReactionAfterReply,
  type HistoryEntry,
} from "openclaw/plugin-sdk";
import type { KookEventData } from "./types.js";
import { resolveKookAccount } from "./accounts.js";
import { createKookReplyDispatcher } from "./reply-dispatcher.js";
import { getKookRuntime } from "./runtime.js";
import { addReaction, deleteReaction, type KookApiOptions } from "./kook/client.js";

/**
 * Extract text content from a Kook event.
 * For KMarkdown messages, uses the raw_content from extra.kmarkdown if available.
 */
function extractContent(event: KookEventData): string {
  // KMarkdown messages: prefer raw_content (plain text without formatting)
  if (event.type === 9 && event.extra?.kmarkdown?.raw_content) {
    return event.extra.kmarkdown.raw_content;
  }
  return event.content;
}

/** Check if the bot was mentioned in a group message. */
function checkBotMentioned(event: KookEventData, botId?: string): boolean {
  if (!botId) {
    return false;
  }
  const mentions = event.extra?.mention ?? [];
  return mentions.includes(botId);
}

/** Strip bot @mentions from text. */
function stripBotMention(text: string, botId?: string): string {
  if (!botId) {
    return text;
  }
  // Kook mentions look like `(met)botId(met)` in KMarkdown
  return text
    .replace(new RegExp(`\\(met\\)${botId}\\(met\\)`, "g"), "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Resolve group allowlist match. */
function isGroupAllowed(params: {
  groupPolicy: string;
  allowFrom: Array<string | number>;
  guildId: string;
  channelId: string;
}): boolean {
  const { groupPolicy, allowFrom, guildId, channelId } = params;
  if (groupPolicy === "disabled") {
    return false;
  }
  if (groupPolicy === "open") {
    return true;
  }
  // allowlist mode - check if guild or channel is in the list
  return allowFrom.some((entry) => String(entry) === guildId || String(entry) === channelId);
}

/** Resolve DM allowlist match. */
function isDmAllowed(params: {
  dmPolicy: string;
  allowFrom: Array<string | number>;
  senderId: string;
}): boolean {
  const { dmPolicy, allowFrom, senderId } = params;
  if (dmPolicy === "open") {
    return true;
  }
  if (dmPolicy === "allowlist") {
    return allowFrom.some((entry) => String(entry) === senderId);
  }
  // "pairing" mode - handled by core framework
  return true;
}

export async function handleKookMessage(params: {
  cfg: ClawdbotConfig;
  event: KookEventData;
  botId?: string;
  runtime?: RuntimeEnv;
  chatHistories?: Map<string, HistoryEntry[]>;
  accountId?: string;
}): Promise<void> {
  const { cfg, event, botId, runtime, chatHistories, accountId } = params;

  const account = resolveKookAccount({ cfg, accountId });
  const kookCfg = account.config;

  const log = runtime?.log ?? console.log;
  const logError = runtime?.error ?? console.error;

  const isGroup = event.channel_type === "GROUP";
  const rawContent = extractContent(event);
  const mentionedBot = checkBotMentioned(event, botId);
  const content = stripBotMention(rawContent, botId);
  const senderName = event.extra?.author?.username;
  const senderId = event.author_id;
  const guildId = event.extra?.guild_id;
  const channelId = event.target_id;

  log(
    `kook[${account.accountId}]: received message from ${senderId} in ${channelId} (${event.channel_type}) | botId=${botId} mentions=${JSON.stringify(event.extra?.mention)} mentionedBot=${mentionedBot} content=${rawContent.slice(0, 120)}`,
  );

  const historyLimit = Math.max(
    0,
    cfg.messages?.groupChat?.historyLimit ?? DEFAULT_GROUP_HISTORY_LIMIT,
  );

  if (isGroup) {
    const groupPolicy = kookCfg?.groupPolicy ?? "allowlist";
    const groupAllowFrom = kookCfg?.groupAllowFrom ?? [];

    if (
      !isGroupAllowed({
        groupPolicy,
        allowFrom: groupAllowFrom,
        guildId: guildId ?? "",
        channelId,
      })
    ) {
      log(`kook[${account.accountId}]: channel ${channelId} not in group allowlist`);
      return;
    }

    // Check per-group config
    const groupConfig = kookCfg?.groups?.[channelId] ?? kookCfg?.groups?.[guildId ?? ""];
    if (groupConfig?.enabled === false) {
      log(`kook[${account.accountId}]: channel ${channelId} is disabled`);
      return;
    }

    const requireMention = groupConfig?.requireMention ?? kookCfg?.requireMention ?? true;

    if (requireMention && !mentionedBot) {
      log(
        `kook[${account.accountId}]: message in ${channelId} did not mention bot, recording to history`,
      );
      if (chatHistories) {
        recordPendingHistoryEntryIfEnabled({
          historyMap: chatHistories,
          historyKey: channelId,
          limit: historyLimit,
          entry: {
            sender: senderId,
            body: `${senderName ?? senderId}: ${content}`,
            timestamp: Date.now(),
            messageId: event.msg_id,
          },
        });
      }
      return;
    }
  } else {
    // DM
    const dmPolicy = kookCfg?.dmPolicy ?? "pairing";
    const allowFrom = kookCfg?.allowFrom ?? [];

    if (!isDmAllowed({ dmPolicy, allowFrom, senderId })) {
      log(`kook[${account.accountId}]: sender ${senderId} not in DM allowlist`);
      return;
    }
  }

  try {
    const core = getKookRuntime();

    const kookFrom = `kook:${senderId}`;
    const kookTo = isGroup ? `channel:${channelId}` : `user:${senderId}`;

    const route = core.channel.routing.resolveAgentRoute({
      cfg,
      channel: "kook",
      accountId: account.accountId,
      peer: {
        kind: isGroup ? "group" : "dm",
        id: isGroup ? channelId : senderId,
      },
    });

    // --- Ack reaction (👀) ---
    const ackReactionScope: AckReactionScope =
      cfg.messages?.ackReactionScope ?? "group-mentions";
    const ackReaction = resolveAckReaction(cfg, route.agentId);
    const requireMentionForAck = isGroup
      ? (kookCfg?.groups?.[channelId]?.requireMention ??
        kookCfg?.groups?.[guildId ?? ""]?.requireMention ??
        kookCfg?.requireMention ??
        true)
      : false;

    const shouldAck =
      ackReaction &&
      isGroup && // KOOK reaction API only works on channel messages
      shouldAckReactionGate({
        scope: ackReactionScope,
        isDirect: !isGroup,
        isGroup,
        isMentionableGroup: isGroup,
        requireMention: requireMentionForAck,
        canDetectMention: true,
        effectiveWasMentioned: mentionedBot,
      });

    const apiOpts: KookApiOptions = { token: account.token! };
    const ackReactionPromise = shouldAck
      ? addReaction(apiOpts, { msg_id: event.msg_id, emoji: ackReaction }).then(
          () => true,
          (err) => {
            log(`kook[${account.accountId}]: ack reaction failed: ${String(err)}`);
            return false;
          },
        )
      : null;

    const removeAckAfterReply = cfg.messages?.removeAckAfterReply ?? false;

    const preview = content.replace(/\s+/g, " ").slice(0, 160);
    const inboundLabel = isGroup
      ? `KOOK[${account.accountId}] message in channel ${channelId}`
      : `KOOK[${account.accountId}] DM from ${senderId}`;

    core.system.enqueueSystemEvent(`${inboundLabel}: ${preview}`, {
      sessionKey: route.sessionKey,
      contextKey: `kook:message:${channelId}:${event.msg_id}`,
    });

    // Build quoted content if available
    let quotedContent: string | undefined;
    if (event.extra?.quote) {
      quotedContent = event.extra.quote.content;
    }

    const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(cfg);

    let messageBody = content;
    if (quotedContent) {
      messageBody = `[Replying to: "${quotedContent}"]\n\n${content}`;
    }

    const speaker = senderName ?? senderId;
    messageBody = `${speaker}: ${messageBody}`;

    const envelopeFrom = isGroup ? `${channelId}:${senderId}` : senderId;

    const body = core.channel.reply.formatAgentEnvelope({
      channel: "KOOK",
      from: envelopeFrom,
      timestamp: new Date(),
      envelope: envelopeOptions,
      body: messageBody,
    });

    let combinedBody = body;
    const historyKey = isGroup ? channelId : undefined;

    if (isGroup && historyKey && chatHistories) {
      combinedBody = buildPendingHistoryContextFromMap({
        historyMap: chatHistories,
        historyKey,
        limit: historyLimit,
        currentMessage: combinedBody,
        formatEntry: (entry) =>
          core.channel.reply.formatAgentEnvelope({
            channel: "KOOK",
            from: `${channelId}:${entry.sender}`,
            timestamp: entry.timestamp,
            body: entry.body,
            envelope: envelopeOptions,
          }),
      });
    }

    const ctxPayload = core.channel.reply.finalizeInboundContext({
      Body: combinedBody,
      RawBody: content,
      CommandBody: content,
      From: kookFrom,
      To: kookTo,
      SessionKey: route.sessionKey,
      AccountId: route.accountId,
      ChatType: isGroup ? "group" : "direct",
      GroupSubject: isGroup ? channelId : undefined,
      SenderName: senderName ?? senderId,
      SenderId: senderId,
      Provider: "kook" as const,
      Surface: "kook" as const,
      MessageSid: event.msg_id,
      Timestamp: Date.now(),
      WasMentioned: mentionedBot,
      CommandAuthorized: true,
      OriginatingChannel: "kook" as const,
      OriginatingTo: kookTo,
    });

    // For DMs, target_id is the bot's own user ID, so we reply to senderId instead
    const replyTarget = isGroup ? channelId : senderId;

    const { dispatcher, replyOptions, markDispatchIdle } = createKookReplyDispatcher({
      cfg,
      agentId: route.agentId,
      runtime: runtime as RuntimeEnv,
      channelId: replyTarget,
      replyToMessageId: event.msg_id,
      accountId: account.accountId,
      isDm: !isGroup,
    });

    log(`kook[${account.accountId}]: dispatching to agent (session=${route.sessionKey})`);

    const { queuedFinal, counts } = await core.channel.reply.dispatchReplyFromConfig({
      ctx: ctxPayload,
      cfg,
      dispatcher,
      replyOptions,
    });

    markDispatchIdle();

    // Remove ack reaction after reply if configured
    removeAckReactionAfterReply({
      removeAfterReply: removeAckAfterReply,
      ackReactionPromise,
      ackReactionValue: shouldAck ? ackReaction : null,
      remove: () =>
        deleteReaction(apiOpts, { msg_id: event.msg_id, emoji: ackReaction }).then(() => {}),
      onError: (err) =>
        log(`kook[${account.accountId}]: remove ack reaction failed: ${String(err)}`),
    });

    if (isGroup && historyKey && chatHistories) {
      clearHistoryEntriesIfEnabled({
        historyMap: chatHistories,
        historyKey,
        limit: historyLimit,
      });
    }

    log(
      `kook[${account.accountId}]: dispatch complete (queuedFinal=${queuedFinal}, replies=${counts.final})`,
    );
  } catch (err) {
    logError(`kook[${account.accountId}]: failed to dispatch message: ${String(err)}`);
  }
}

import {
  createReplyPrefixContext,
  type ClawdbotConfig,
  type RuntimeEnv,
  type ReplyPayload,
} from "openclaw/plugin-sdk";
import { resolveKookAccount } from "./accounts.js";
import { sendMessageKook } from "./kook/send.js";
import { getKookRuntime } from "./runtime.js";

export type CreateKookReplyDispatcherParams = {
  cfg: ClawdbotConfig;
  agentId: string;
  runtime: RuntimeEnv;
  channelId: string;
  replyToMessageId?: string;
  accountId?: string;
  isDm?: boolean;
};

export function createKookReplyDispatcher(params: CreateKookReplyDispatcherParams) {
  const core = getKookRuntime();
  const { cfg, agentId, channelId, replyToMessageId, accountId, isDm } = params;

  const account = resolveKookAccount({ cfg, accountId });

  const prefixContext = createReplyPrefixContext({ cfg, agentId });

  const textChunkLimit = core.channel.text.resolveTextChunkLimit({
    cfg,
    channel: "kook",
    defaultLimit: 4000,
  });
  const chunkMode = core.channel.text.resolveChunkMode(cfg, "kook");

  const { dispatcher, replyOptions, markDispatchIdle } =
    core.channel.reply.createReplyDispatcherWithTyping({
      responsePrefix: prefixContext.responsePrefix,
      responsePrefixContextProvider: prefixContext.responsePrefixContextProvider,
      humanDelay: core.channel.reply.resolveHumanDelayConfig(cfg, agentId),
      deliver: async (payload: ReplyPayload) => {
        params.runtime.log?.(
          `kook[${account.accountId}] deliver called: text=${payload.text?.slice(0, 100)}`,
        );
        const text = payload.text ?? "";
        if (!text.trim()) {
          params.runtime.log?.(`kook[${account.accountId}] deliver: empty text, skipping`);
          return;
        }

        const chunks = core.channel.text.chunkTextWithMode(text, textChunkLimit, chunkMode);
        params.runtime.log?.(
          `kook[${account.accountId}] deliver: sending ${chunks.length} chunks to ${channelId}`,
        );

        // Determine target based on whether it's a DM
        const to = isDm ? `user:${channelId}` : channelId;

        for (const chunk of chunks) {
          await sendMessageKook({
            cfg,
            to,
            text: chunk,
            replyToMessageId,
            accountId,
            isDm,
          });
        }
      },
      onError: (err, info) => {
        params.runtime.error?.(
          `kook[${account.accountId}] ${info.kind} reply failed: ${String(err)}`,
        );
      },
    });

  return {
    dispatcher,
    replyOptions: {
      ...replyOptions,
      onModelSelected: prefixContext.onModelSelected,
    },
    markDispatchIdle,
  };
}

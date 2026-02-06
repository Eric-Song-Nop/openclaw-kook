import type { ChannelOutboundAdapter } from "openclaw/plugin-sdk";
import { loadWebMedia } from "openclaw/plugin-sdk";
import { sendMessageKook, sendMediaKook } from "./kook/send.js";
import { getKookRuntime } from "./runtime.js";

export const kookOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  chunker: (text, limit) => getKookRuntime().channel.text.chunkMarkdownText(text, limit),
  chunkerMode: "markdown",
  textChunkLimit: 4000,

  sendText: async ({ cfg, to, text, accountId }) => {
    const isDm = to.startsWith("user:") || to.startsWith("kook:user:");
    const result = await sendMessageKook({ cfg, to, text, accountId, isDm });
    return { channel: "kook", ...result };
  },

  sendMedia: async ({ cfg, to, text, mediaUrl, accountId }) => {
    const isDm = to.startsWith("user:") || to.startsWith("kook:user:");

    // Send caption text first if provided alongside media
    if (text?.trim() && mediaUrl) {
      await sendMessageKook({ cfg, to, text, accountId, isDm });
    }

    if (mediaUrl) {
      const media = await loadWebMedia(mediaUrl);
      const result = await sendMediaKook({
        cfg,
        to,
        buffer: media.buffer,
        fileName: media.fileName,
        contentType: media.contentType,
        accountId,
        isDm,
      });
      return { channel: "kook", ...result };
    }

    // No media, just send text
    const result = await sendMessageKook({ cfg, to, text: text ?? "", accountId, isDm });
    return { channel: "kook", ...result };
  },
};

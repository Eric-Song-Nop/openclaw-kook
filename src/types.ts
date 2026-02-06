import type { KookConfigSchema, z } from "./config-schema.js";

export type KookConfig = z.infer<typeof KookConfigSchema>;

export type ResolvedKookAccount = {
  accountId: string;
  enabled: boolean;
  configured: boolean;
  name?: string;
  token?: string;
  tokenSource?: "config" | "env";
  /** Merged config (top-level defaults + account-specific overrides) */
  config: KookConfig;
};

export type KookMessageContext = {
  channelId: string;
  guildId?: string;
  messageId: string;
  senderId: string;
  senderName?: string;
  chatType: "direct" | "group";
  mentionedBot: boolean;
  content: string;
};

export type KookSendResult = {
  messageId: string;
  chatId: string;
};

export type KookProbeResult = {
  ok: boolean;
  error?: string;
  botId?: string;
  botName?: string;
};

/** Raw Kook event data (signal type 0) */
export type KookEventData = {
  channel_type: "GROUP" | "PERSON" | "BROADCAST";
  type: number; // 1=text, 2=image, 3=video, 4=file, 8=audio, 9=kmarkdown, 10=card, 255=system
  target_id: string;
  author_id: string;
  content: string;
  msg_id: string;
  msg_timestamp: number;
  nonce: string;
  extra: {
    type?: number | string;
    guild_id?: string;
    channel_name?: string;
    mention?: string[];
    mention_all?: boolean;
    mention_here?: boolean;
    mention_roles?: number[];
    author?: {
      id: string;
      username: string;
      identify_num?: string;
      online?: boolean;
      os?: string;
      status?: number;
      avatar?: string;
      nickname?: string;
      roles?: number[];
      bot?: boolean;
    };
    kmarkdown?: {
      raw_content?: string;
      mention_part?: Array<{ id: string; username: string }>;
      mention_role_part?: Array<{ role_id: number; name: string }>;
    };
    // DM-specific fields
    code?: string; // chat_code for DMs
    last_msg_content?: string;
    // Quote fields
    quote?: {
      id: string;
      type: number;
      content: string;
      create_at: number;
      author: {
        id: string;
        username: string;
        avatar?: string;
      };
    };
    body?: Record<string, unknown>;
  };
};

/** Kook WebSocket signal frame */
export type KookSignalFrame = {
  s: number; // 0=event, 1=hello, 2=ping, 3=pong, 5=reconnect, 6=resume_ack
  d: Record<string, unknown>;
  sn?: number;
};

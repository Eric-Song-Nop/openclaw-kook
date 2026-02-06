/** Kook REST API client. */

const KOOK_API_BASE = "https://www.kookapp.cn/api/v3";

export type KookApiOptions = {
  token: string;
};

export type KookApiResponse<T = unknown> = {
  code: number;
  message: string;
  data: T;
};

/**
 * Low-level Kook API request helper.
 * All requests use `Authorization: Bot <token>`.
 */
async function kookRequest<T = unknown>(
  opts: KookApiOptions,
  method: string,
  path: string,
  body?: Record<string, unknown>,
  query?: Record<string, string>,
): Promise<KookApiResponse<T>> {
  const url = new URL(`${KOOK_API_BASE}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      url.searchParams.set(k, v);
    }
  }

  const headers: Record<string, string> = {
    Authorization: `Bot ${opts.token}`,
  };

  const init: RequestInit = { method, headers };

  if (body && (method === "POST" || method === "PUT" || method === "PATCH")) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  const res = await fetch(url.toString(), init);
  const json = (await res.json()) as KookApiResponse<T>;
  return json;
}

// --- Public API methods ---

export type KookGatewayData = {
  url: string;
};

/** GET /gateway/index - obtain the WebSocket gateway URL */
export async function getGateway(
  opts: KookApiOptions,
  compress = 0,
): Promise<KookApiResponse<KookGatewayData>> {
  return kookRequest<KookGatewayData>(opts, "GET", "/gateway/index", undefined, {
    compress: String(compress),
  });
}

export type KookUserData = {
  id: string;
  username: string;
  identify_num?: string;
  online?: boolean;
  avatar?: string;
  bot?: boolean;
};

/** GET /user/me - get current bot user info */
export async function getBotInfo(opts: KookApiOptions): Promise<KookApiResponse<KookUserData>> {
  return kookRequest<KookUserData>(opts, "GET", "/user/me");
}

export type KookMessageCreateData = {
  msg_id: string;
  msg_timestamp: number;
  nonce: string;
};

/** POST /message/create - send a message to a channel */
export async function sendChannelMessage(
  opts: KookApiOptions,
  params: {
    target_id: string;
    content: string;
    type?: number; // 1=text, 9=kmarkdown (default), 10=card
    quote?: string; // message_id to reply to
    temp_target_id?: string; // for ephemeral messages
  },
): Promise<KookApiResponse<KookMessageCreateData>> {
  return kookRequest<KookMessageCreateData>(opts, "POST", "/message/create", {
    target_id: params.target_id,
    content: params.content,
    type: params.type ?? 9, // KMarkdown by default
    ...(params.quote ? { quote: params.quote } : {}),
    ...(params.temp_target_id ? { temp_target_id: params.temp_target_id } : {}),
  });
}

export type KookDmCreateData = {
  msg_id: string;
  msg_timestamp: number;
  nonce: string;
};

/** POST /direct-message/create - send a direct message */
export async function sendDirectMessage(
  opts: KookApiOptions,
  params: {
    target_id?: string; // user ID
    chat_code?: string; // DM session code
    content: string;
    type?: number;
    quote?: string;
  },
): Promise<KookApiResponse<KookDmCreateData>> {
  return kookRequest<KookDmCreateData>(opts, "POST", "/direct-message/create", {
    content: params.content,
    type: params.type ?? 9,
    ...(params.target_id ? { target_id: params.target_id } : {}),
    ...(params.chat_code ? { chat_code: params.chat_code } : {}),
    ...(params.quote ? { quote: params.quote } : {}),
  });
}

/** POST /message/update - edit a channel message */
export async function updateChannelMessage(
  opts: KookApiOptions,
  params: {
    msg_id: string;
    content: string;
  },
): Promise<KookApiResponse<void>> {
  return kookRequest<void>(opts, "POST", "/message/update", {
    msg_id: params.msg_id,
    content: params.content,
  });
}

/** POST /message/delete - delete a channel message */
export async function deleteChannelMessage(
  opts: KookApiOptions,
  params: { msg_id: string },
): Promise<KookApiResponse<void>> {
  return kookRequest<void>(opts, "POST", "/message/delete", {
    msg_id: params.msg_id,
  });
}

/**
 * Convert a unicode emoji character to KOOK's bracket-encoded emoji id.
 * e.g. "👀" (U+1F440) → "[#128064;]"
 */
export function emojiToKookId(emoji: string): string {
  const codePoint = emoji.codePointAt(0);
  if (codePoint === undefined) {
    return emoji;
  }
  // Only encode if it's outside basic ASCII range (i.e. a real emoji)
  if (codePoint > 0x7f) {
    return `[#${codePoint};]`;
  }
  return emoji;
}

/** POST /message/add-reaction - add an emoji reaction to a channel message */
export async function addReaction(
  opts: KookApiOptions,
  params: {
    msg_id: string;
    emoji: string;
  },
): Promise<KookApiResponse<void>> {
  return kookRequest<void>(opts, "POST", "/message/add-reaction", {
    msg_id: params.msg_id,
    emoji: emojiToKookId(params.emoji),
  });
}

/** POST /message/delete-reaction - remove an emoji reaction from a channel message */
export async function deleteReaction(
  opts: KookApiOptions,
  params: {
    msg_id: string;
    emoji: string;
    user_id?: string;
  },
): Promise<KookApiResponse<void>> {
  return kookRequest<void>(opts, "POST", "/message/delete-reaction", {
    msg_id: params.msg_id,
    emoji: emojiToKookId(params.emoji),
    ...(params.user_id ? { user_id: params.user_id } : {}),
  });
}

export type KookAssetData = {
  url: string;
};

/** POST /asset/create - upload a file to KOOK's CDN (multipart/form-data) */
export async function uploadAsset(
  opts: KookApiOptions,
  file: Buffer | Uint8Array,
  fileName?: string,
): Promise<KookApiResponse<KookAssetData>> {
  const url = `${KOOK_API_BASE}/asset/create`;
  const form = new FormData();
  form.append("file", new Blob([file]), fileName ?? "upload");

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bot ${opts.token}` },
    body: form,
  });
  return (await res.json()) as KookApiResponse<KookAssetData>;
}

export type KookUserChatData = {
  code: string;
  last_read_time: number;
  latest_msg_time: number;
  unread_count: number;
  target_info: KookUserData;
};

/** POST /user-chat/create - create a DM session with a user */
export async function createUserChat(
  opts: KookApiOptions,
  params: { target_id: string },
): Promise<KookApiResponse<KookUserChatData>> {
  return kookRequest<KookUserChatData>(opts, "POST", "/user-chat/create", {
    target_id: params.target_id,
  });
}

export { z } from "zod";
import { z } from "zod";

export const KookAccountConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    name: z.string().optional(),
    token: z.string().optional(),
    dmPolicy: z.enum(["open", "pairing", "allowlist"]).optional(),
    allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
    groupPolicy: z.enum(["open", "allowlist", "disabled"]).optional(),
    groupAllowFrom: z.array(z.union([z.string(), z.number()])).optional(),
    requireMention: z.boolean().optional(),
    textChunkLimit: z.number().int().min(1).optional(),
    groups: z
      .record(
        z.string(),
        z
          .object({
            enabled: z.boolean().optional(),
            requireMention: z.boolean().optional(),
            allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
          })
          .optional(),
      )
      .optional(),
  })
  .strict();

export const KookConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    token: z.string().optional(),
    name: z.string().optional(),
    dmPolicy: z.enum(["open", "pairing", "allowlist"]).optional().default("pairing"),
    allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
    groupPolicy: z.enum(["open", "allowlist", "disabled"]).optional().default("allowlist"),
    groupAllowFrom: z.array(z.union([z.string(), z.number()])).optional(),
    requireMention: z.boolean().optional().default(true),
    textChunkLimit: z.number().int().min(1).optional(),
    groups: z
      .record(
        z.string(),
        z
          .object({
            enabled: z.boolean().optional(),
            requireMention: z.boolean().optional(),
            allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
          })
          .optional(),
      )
      .optional(),
    accounts: z.record(z.string(), KookAccountConfigSchema.optional()).optional(),
  })
  .strict();

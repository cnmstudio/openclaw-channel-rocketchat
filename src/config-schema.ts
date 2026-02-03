import { z } from 'zod';

// Rocket.Chat 配置 Schema
export const RocketChatConfigSchema = z.object({
  enabled: z.boolean().optional().default(true),
  webhookUrl: z.string().url().describe('Rocket.Chat webhook URL for sending messages'),
  authToken: z.string().min(1).describe('Authentication token for validating incoming messages'),
  dmPolicy: z.enum(['open', 'pairing', 'allowlist']).optional().default('open'),
  groupPolicy: z.enum(['open', 'allowlist']).optional().default('open'),
  allowFrom: z.array(z.string()).optional().default(() => []),
  messageType: z.enum(['text', 'markdown']).optional().default('markdown'),
  showThinking: z.boolean().optional().default(true),
  debug: z.boolean().optional().default(false),
  name: z.string().optional(),
});

export type RocketChatConfigType = z.infer<typeof RocketChatConfigSchema>;
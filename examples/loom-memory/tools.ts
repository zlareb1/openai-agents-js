import { Agent as LoomAgent } from '@clickhouse/loom';
import { tool } from '@openai/agents';
import { z } from 'zod';

/** Bind application-owned identity outside model-controlled tool arguments. */
export function preferenceTools(
  memory: LoomAgent,
  userId: string,
  key: string,
) {
  const remember = tool({
    name: 'remember_preference',
    description:
      'Store the user preference under the application-selected key.',
    parameters: z.object({ preference: z.string() }),
    errorFunction: null,
    execute: async ({ preference }) =>
      JSON.stringify(
        await memory.remember(key, preference, {
          userId,
          memory_type: 'preference',
        }),
      ),
  });
  const recall = tool({
    name: 'recall_preference',
    description: 'Search the application-selected user scope for a preference.',
    parameters: z.object({ query: z.string() }),
    errorFunction: null,
    execute: async ({ query }) =>
      JSON.stringify(
        await memory.recall(query, {
          userId,
          agentId: memory.agent,
          top_k: 5,
          bodies: 'full',
        }),
      ),
  });
  return { remember, recall };
}

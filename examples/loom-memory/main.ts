import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Agent as LoomAgent } from '@clickhouse/loom';
import { Agent, Runner } from '@openai/agents';
import {
  ScriptedModel,
  assistantMessage,
  functionCall,
} from '@openai/agents/testing';
import { preferenceTools } from './tools.ts';

function toolResponse(model: ScriptedModel): Record<string, unknown> {
  const input = model.calls[1]?.request.input;
  if (!Array.isArray(input)) {
    throw new Error('The scripted run did not receive a tool result.');
  }
  const result = input.find((item) => item.type === 'function_call_result');
  if (!result || typeof result.output !== 'string') {
    throw new Error('The scripted run did not receive the JSON tool result.');
  }
  return JSON.parse(result.output) as Record<string, unknown>;
}

/** Exercise separate native agents without giving either a shared transcript. */
export async function runDemo(
  writerMemory: LoomAgent,
  readerMemory: LoomAgent,
  demoId: string,
) {
  const userId = `demo-${demoId}`;
  const key = `examples/preferences/${demoId}`;
  const preference = 'The demo traveler prefers an aisle seat.';
  const writerTools = preferenceTools(writerMemory, userId, key);
  const readerTools = preferenceTools(readerMemory, userId, key);
  const writerModel = new ScriptedModel([
    [
      functionCall(
        'remember_preference',
        { preference },
        { callId: 'write-preference' },
      ),
    ],
    [assistantMessage('The preference tool has returned.')],
  ]);
  const readerModel = new ScriptedModel([
    [
      functionCall(
        'recall_preference',
        { query: 'seat preference' },
        { callId: 'read-preference' },
      ),
    ],
    [assistantMessage('The recall tool has returned.')],
  ]);
  const runner = new Runner({ tracingDisabled: true });
  await runner.run(
    new Agent({
      name: 'Preference collector',
      model: writerModel,
      tools: [writerTools.remember],
    }),
    'Store my preference for an aisle seat.',
  );
  const receipt = toolResponse(writerModel);
  if (
    !receipt.memory_id ||
    !receipt.version ||
    receipt.noop ||
    receipt.dry_run
  ) {
    throw new Error(
      'Loom did not confirm writing the demonstration preference.',
    );
  }
  await runner.run(
    new Agent({
      name: 'Booking assistant',
      model: readerModel,
      tools: [readerTools.recall],
    }),
    'Retrieve the stored seat preference.',
  );
  const recalled = toolResponse(readerModel);
  writerModel.assertComplete();
  readerModel.assertComplete();
  return { receipt, recalled, writerModel, readerModel };
}

async function main() {
  const { LOOM_BASE_URL, LOOM_API_KEY, LOOM_ORG, LOOM_NAMESPACE } = process.env;
  if (!LOOM_BASE_URL || !LOOM_API_KEY || !LOOM_ORG || !LOOM_NAMESPACE) {
    throw new Error(
      'Configure the four LOOM environment variables in README.md.',
    );
  }
  const createMemory = () =>
    new LoomAgent(LOOM_ORG, LOOM_NAMESPACE, 'travel-preferences', {
      baseUrl: LOOM_BASE_URL,
      apiKey: LOOM_API_KEY,
    });
  const { recalled } = await runDemo(
    createMemory(),
    createMemory(),
    randomUUID(),
  );
  console.log(JSON.stringify(recalled, null, 2));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(() => {
    console.error('The example failed; no completion is claimed.');
    process.exitCode = 1;
  });
}

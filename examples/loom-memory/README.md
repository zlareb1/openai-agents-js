# User memory shared by two agent roles

A preference collector receives a write tool. A booking assistant receives a read tool and starts with no collector transcript. Both tools use the same application-selected Loom user, namespace and memory owner. The read tool returns the complete search response, including abstention and other retrieval metadata; it does not treat any result as verified merely because a match exists.

The example uses real native `tool` objects, `Runner` and public `ScriptedModel` utilities. Model outputs are predetermined. This checks tool orchestration, not reasoning. OpenAI inference and tracing are disabled. Running the example still calls your Loom service, whose configured memory providers may incur costs. The tests inject a synthetic `fetch` into the published Loom client and make no network or service calls.

## Install and check

Use the repository's supported Node.js and pinned pnpm versions. From the repository root:

```sh
pnpm install
pnpm build
pnpm exec vitest run examples/loom-memory/tools.test.ts
pnpm --filter loom-memory build-check
```

The example pins the published base package `@clickhouse/loom@1.2.0`. It calls its public `Agent.remember` and `Agent.recall` methods directly and preserves their responses. It adds no dependency to an SDK runtime package and makes no claim about Loom's separate OpenAI adapter or session backend. The example tests are explicitly included in the existing workspace Vitest project, so ordinary CI runs them.

The tests check real native tool dispatch, separate role tool sets, a new client's read of synthetic stored data, fixed scope forwarding, receipt metadata, abstention and storage failures. Mock responses do not establish server authorization, durability, search quality or production reliability. Exposing only one tool to each role constrains the offered tool set; it is not a replacement for server permissions.

## Run with a configured service

Supply `LOOM_BASE_URL`, `LOOM_API_KEY`, `LOOM_ORG` and `LOOM_NAMESPACE` through your environment or secret manager. Use a dedicated namespace and a token with the required memory read/write permissions. Do not put credentials into the source or model input.

```sh
pnpm --filter loom-memory start
```

Each invocation writes a synthetic preference under a new demonstration user and key, then prints the full read-tool response. No transcript is written to Loom by this example. It performs no deletion; retire the synthetic records through the service's supported erasure workflow. A new client object in this process is not proof of a process restart or production persistence.

The writer checks the actual receipt before starting the reader. A missing receipt, `noop` or `dry_run` is not reported as a new write. The reader retains search abstention and provenance fields for the application to assess; scripted assistant text does not decide whether the memory is sufficient. Storage errors abort the example rather than becoming success text.

Loom is maintained separately from the Agents SDK. This example does not add a built-in memory backend or an OpenAI support commitment.

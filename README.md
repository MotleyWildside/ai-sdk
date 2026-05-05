# @motleywildside/ai-sdk

A TypeScript SDK for building AI apps with multiple LLM providers, structured outputs, prompt management, caching, and pipelines.

---

## ✨ Features

- **Unified API**: One interface for OpenAI, Gemini, and OpenRouter (Anthropic, Meta Llama, Mistral, DeepSeek, Cohere, Qwen, and more via OpenRouter).
- **Smart Caching**: Built-in `read_through` and `refresh` modes to save costs and latency.
- **Type-Safe Schema**: Native Zod integration for schema-validated structured outputs. Parse failures and schema mismatches raise typed errors (`LLMParseError` / `LLMSchemaError`) for explicit handling.
- **Prompt Registry**: Decouple prompts from code with versioning and variables.
- **Pipeline Orchestrator**: Build complex, stateful AI workflows with ease.

## 🚀 Quick Start

### 1. Install

```bash
npm install @motleywildside/ai-sdk
```

### 2. Initialize

```typescript
import { LMService, OpenAIProvider } from "@motleywildside/ai-sdk";

const llm = new LMService({
  providers: [new OpenAIProvider(process.env.OPENAI_API_KEY)],
  enableCache: true,
});
```

### 3. Register Prompts

Decouple your prompts from code using the built-in registry. Supports variables, versioning, and model defaults.

```typescript
llm.promptRegistry.register({
  promptId: "hello_world",
  version: 1,
  systemPrompt: "You are a helpful assistant.",
  userPrompt: "Hello, {name}! How are you today?",
  output: { type: "text" },
  modelDefaults: {
    model: "gpt-4o",
    temperature: 0.7,
  },
});

llm.promptRegistry.register({
  promptId: "get_city_info",
  version: 1,
  systemPrompt: "You are a travel expert.",
  userPrompt: "Provide details about {city}.",
  output: { type: "json" }, // Enforces JSON mode
  modelDefaults: { model: "gemini-1.5-flash" },
});
```

### 4. Basic Call

```typescript
const result = await llm.callText({
  promptId: "hello_world",
  variables: { name: "User" },
});

console.log(result.text);
```

### 5. Structured JSON (with Zod)

```typescript
const result = await llm.callJSON({
  promptId: "get_city_info",
  variables: { city: "Paris" },
  jsonSchema: z.object({
    population: z.number(),
    landmark: z.string(),
  }),
});

console.log(result.data.landmark); // Fully typed
```

## ⛓️ Pipelines

Build complex multi-step workflows with the `PipelineOrchestrator`:

```typescript
import { PipelineOrchestrator, ok } from "@motleywildside/ai-sdk";

const pipe = new PipelineOrchestrator({
  steps: [
    {
      name: "classify",
      run: async (ctx) => ok({ ctx: { ...ctx, category: "support" } }),
    },
    {
      name: "respond",
      run: async (ctx) => ok({ ctx: { ...ctx, reply: "How can I help?" } }),
    },
  ],
});

const { status, ctx } = await pipe.run({ input: "..." });
```

## 🛠️ Configuration

Full control over retries, logging, and custom providers:

```typescript
const llm = new LMService({
  providers: [...],
  maxRetries: 3,
  logger: new MyCustomLogger(),
  cacheProvider: new RedisCacheProvider() // Easy to extend
});
```

## 💾 Caching

Optimize your costs and performance with flexible caching modes:

- `read_through`: (Default) Checks cache first, calls LLM on miss, then stores the result.
- `bypass`: Completely ignores the cache for both reading and writing.
- `refresh`: Forces a fresh LLM call and updates the cache with the new value.

```typescript
const result = await llm.callText({
  promptId: "expensive_query",
  cache: { mode: "read_through", ttlSeconds: 3600 },
});
```

## Learn by example

The [`examples/`](examples/) directory contains copy-paste-ready examples for every realistic integration shape — from a first call through custom providers, production pipelines, and framework integrations.

**Curated starting points:**

- [RAG pipeline](examples/rag-pipeline.md) — embed → retrieve → rerank → generate, end-to-end
- [Tool-using agent](examples/agent-with-tools.md) — ReAct-style agent with calculator and search tools
- [Custom provider — Anthropic](src/llm-service/examples/extensions/custom-provider-anthropic.md) — complete `LLMProvider` implementation with `@anthropic-ai/sdk`
- [Circuit breaker policy](src/orchestrator/examples/extensions/custom-policy-circuit-breaker.md) — resilient production pipelines that degrade gracefully
- [Streaming UI server](examples/streaming-ui-server.md) — Express SSE handler with client-disconnect cancellation

Browse the full index: [examples/README.md](examples/README.md)

---

## 📄 License

MIT © [MotleyWildside](https://github.com/MotleyWildside)

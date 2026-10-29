# Installation and runtimes

`@ultrarouter/sdk` has zero runtime dependencies and talks to the gateway with the platform
`fetch`. It ships ESM and CommonJS builds with TypeScript declarations.

| Runtime                                         | Support                                                                                                                                                                                          |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Node.js 20, 22, 24                              | Supported and tested in CI (every check, on each version).                                                                                                                                       |
| Deno 2                                          | Supported and tested in CI: the pack smoke runs the installed package under Deno (chat, streaming, embeddings, typed errors, the context entry).                                                 |
| Bun                                             | Expected to work (the client uses only `fetch`, `AbortController`, `TextDecoder` and `crypto`, and Bun runs Node.js packages), but no automated test runs on Bun.                                |
| Edge runtimes (Cloudflare Workers, Vercel Edge) | Expected to work for the client (Web APIs only), but no automated test runs on an edge runtime. The context entry and `FileOutcomeStore` need Node.js APIs; see [edge runtimes](#edge-runtimes). |

## Install

`@ultrarouter/sdk` is **not published to the npm registry yet**: `npm install @ultrarouter/sdk`
answers 404 today. Install it from the public GitHub source by building the package and installing
the tarball it produces. Select `feat/learning-loop` for this 0.1.0 preview; the default
branch does not yet include the learning additions:

<!-- doctest: skip — clones the public repository and builds the package -->

```bash
git clone --branch feat/learning-loop --single-branch https://github.com/lucastonon/ultrarouter-sdk-typescript.git
cd ultrarouter-sdk-typescript
npm ci && npm run build && npm pack   # writes ultrarouter-sdk-0.1.0.tgz

cd ../your-app
npm install ../ultrarouter-sdk-typescript/ultrarouter-sdk-0.1.0.tgz
```

The same tarball works with the other package managers:

<!-- doctest: skip — installs a locally built tarball with other package managers -->

```bash
pnpm add ../ultrarouter-sdk-typescript/ultrarouter-sdk-0.1.0.tgz
yarn add ../ultrarouter-sdk-typescript/ultrarouter-sdk-0.1.0.tgz
bun add ../ultrarouter-sdk-typescript/ultrarouter-sdk-0.1.0.tgz
```

A git dependency (`npm install github:lucastonon/ultrarouter-sdk-typescript`) does not work: the
repository holds no prebuilt `dist/`, and installing does not build it.

Then set your key:

```bash
export ULTRAROUTER_API_KEY=ur_sk_test_...
```

## ES modules

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter();
const res = await ur.chat.completions.create({
  model: 'openai/gpt-5.2-mini',
  messages: [{ role: 'user', content: 'Hello from ESM' }],
});
console.log(res.choices[0]?.message.content);
```

Named imports work too: `import { UltraRouter, UltraRouterError } from '@ultrarouter/sdk'`.

## CommonJS

`require()` returns the module namespace. Use the named `UltraRouter` export (the default export is
also available as `.default`):

```js
const { UltraRouter, UltraRouterError } = require('@ultrarouter/sdk');

const ur = new UltraRouter();
ur.chat.completions
  .create({ model: 'openai/gpt-5.2-mini', messages: [{ role: 'user', content: 'Hello from CJS' }] })
  .then((res) => console.log(res.choices[0].message.content))
  .catch((err) => {
    if (err instanceof UltraRouterError) console.error(err.code);
    process.exitCode = 1;
  });
```

## Entry points

| Import                      | Contents                                                                                                                                                                                                                                            |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@ultrarouter/sdk`          | The `UltraRouter` client, every request/response type, errors, and the pure helpers.                                                                                                                                                                |
| `@ultrarouter/sdk/context`  | The pure context runtime (modules, contracts, `compile`, `fromMessages` / `toMessages`), knowledge packs, the learned-module placement rule and the hosted-prompt renderer. No network. See [context runtime](./context-runtime.md).                |
| `@ultrarouter/sdk/learning` | Starter outcome adapters (verifiers, a business-rule validator, a signed-webhook receiver) and the order-desk demonstration environment. No network of its own. See [plug-and-play learning](./plug-and-play-learning.md#starter-outcome-adapters). |
| `ur` (binary)               | The command-line tool for CI gates and outcome imports. Node.js only. See [CLI](./cli.md).                                                                                                                                                          |

Importing the client never loads the context runtime or the learning starters, and the reverse.

## Node.js

Node.js 20 or later. Everything works, including `FileOutcomeStore` (durable outcome queue on disk)
and the `ur` CLI:

```bash
npx ur --version
```

## Bun

Bun runs the same code as Node.js, ESM or CommonJS. Bun is not covered by the automated tests; report
anything that behaves differently there.

<!-- doctest: skip — needs Bun and a locally built tarball -->

```bash
bun add ../ultrarouter-sdk-typescript/ultrarouter-sdk-0.1.0.tgz
ULTRAROUTER_API_KEY=ur_sk_test_... bun run app.ts
```

## Deno

Import through the `npm:` specifier and grant network and environment access:

<!-- doctest: skip — Deno-only `npm:` import specifier; the same code runs under Node.js in the ES modules section above -->

```ts
import UltraRouter from 'npm:@ultrarouter/sdk';

const ur = new UltraRouter();
const res = await ur.chat.completions.create({
  model: 'openai/gpt-5.2-mini',
  messages: [{ role: 'user', content: 'Hello from Deno' }],
});
console.log(res.choices[0]?.message.content);
```

<!-- doctest: skip — needs Deno; the pack smoke runs the built package under Deno when it is installed -->

```bash
deno run --allow-net --allow-env main.ts
```

## Edge runtimes

The client needs only `fetch`, `AbortController`, `TextDecoder` and `crypto`, so it is designed to
run on edge runtimes such as Cloudflare Workers or Vercel Edge Functions; no automated test runs on
one yet. Edge runtimes usually have no `process.env`, so pass the key and base URL explicitly:

```ts
import UltraRouter from '@ultrarouter/sdk';

interface Env {
  ULTRAROUTER_API_KEY: string;
  ULTRAROUTER_BASE_URL?: string;
}

// A Cloudflare Workers-style module: the platform calls `fetch(request, env)`.
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const ur = new UltraRouter({
      apiKey: env.ULTRAROUTER_API_KEY,
      ...(env.ULTRAROUTER_BASE_URL !== undefined ? { baseURL: env.ULTRAROUTER_BASE_URL } : {}),
    });
    const { question } = (await request.json()) as { question: string };
    const res = await ur.chat.completions.create({
      model: 'openai/gpt-5.2-mini',
      messages: [{ role: 'user', content: question }],
    });
    return Response.json({ answer: res.choices[0]?.message.content ?? '' });
  },
};
```

Not available on edge runtimes: `FileOutcomeStore` (it needs `node:fs`; use the default
`MemoryOutcomeStore` or your own `OutcomeStore`) and the `ur` CLI. The `@ultrarouter/sdk/context`
entry uses `node:crypto` for sha256; it runs where `node:crypto` is available (Node.js, Bun, Deno,
and edge runtimes with Node.js compatibility enabled).

## Browsers

The SDK works in a browser bundle, but do not ship an API key to browsers: anyone who loads the
page can read it. Call the gateway from your server and expose your own endpoint instead.

## TypeScript

Types are bundled; no `@types` package is needed. TypeScript 5 or later is recommended. To resolve
the `@ultrarouter/sdk/context` subpath, use `"moduleResolution": "bundler"`, `"node16"` or
`"nodenext"` (the older `"node"` resolution cannot read package `exports`). The types are written
for `strict` mode.

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true
  }
}
```

## Verify the install

```ts
import UltraRouter, { VERSION } from '@ultrarouter/sdk';

const ur = new UltraRouter();
const key = await ur.ur.key.get();
console.log(`@ultrarouter/sdk ${VERSION} → ${ur.baseURL} (key mode: ${key.mode})`);
```

## Related

- [Configuration](./configuration.md) · [Troubleshooting](./troubleshooting.md)
- [Context runtime](./context-runtime.md) · [CLI](./cli.md)

/**
 * Hosted prompts: create a version, activate it, then fetch and render it client-side with the same
 * fail-closed rule the gateway applies.
 *
 * Run (the key needs `config:write`):
 *
 *   ULTRAROUTER_API_KEY=ur_sk_test_... npx tsx examples/hosted-prompts.ts
 *
 * See docs/call-types.md#hosted-prompts and docs/preflight.md.
 */
import UltraRouter, {
  PromptVariablesMissingError,
  renderPrompt,
  type RenderablePrompt,
} from '@ultrarouter/sdk';

const ur = new UltraRouter();

const version = await ur.ur.callTypes.prompts.create('support-reply', {
  template: 'You are a support assistant for {{brand}}. Answer in {{language}}.',
  variables: [
    { name: 'brand', required: true },
    { name: 'language', required: false },
  ],
});
console.log(`created hosted prompt version ${String(version.version)}`);

// Activate without gateway_apply: the gateway keeps your messages as they are and you render it.
await ur.ur.callTypes.prompts.activate('support-reply', version.version, { gateway_apply: false });

// `getPrompt` returns null for a code-owned call type; fall back to the version we just created.
const hosted = await ur.getPrompt('support-reply');
const prompt: RenderablePrompt = hosted ?? {
  template: version.template,
  variables: version.variables.map((v) => ({ name: v.name, required: v.required ?? false })),
};

console.log(renderPrompt(prompt, { brand: 'Acme', language: 'English' }));

try {
  renderPrompt(prompt, {});
} catch (err) {
  if (err instanceof PromptVariablesMissingError)
    console.log(`refused, missing: ${err.missing.join(', ')}`);
  else throw err;
}

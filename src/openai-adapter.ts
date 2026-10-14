/**
 * The `asOpenAI()` adapter. It returns an OpenAI-client-compatible configuration (base URL and key) so
 * a codebase that uses the official `openai` package can switch to the gateway by changing the
 * constructor arguments only. `openai` is not a dependency of this SDK: pass the `OpenAI` constructor
 * to get a ready instance, or use the returned configuration yourself.
 */

/** The preset an OpenAI-compatible client needs: `{ baseURL, apiKey }`. */
export interface OpenAICompatConfig {
  /** Already includes the `/v1` suffix the OpenAI client expects. */
  baseURL: string;
  /** The API key. */
  apiKey: string;
  /** Headers to send on every request (for example Bench capture headers). */
  defaultHeaders?: Record<string, string>;
}

/** A minimal OpenAI-client constructor shape (the official `openai` package matches). */
export type OpenAIConstructor<T> = new (opts: {
  baseURL: string;
  apiKey: string;
  defaultHeaders?: Record<string, string>;
}) => T;

/**
 * Build the OpenAI-compatible preset. With a constructor argument (e.g. the official
 * `OpenAI` class) it returns a ready instance; without one it returns the config.
 */
export function buildOpenAIAdapter(preset: OpenAICompatConfig): OpenAICompatConfig;
export function buildOpenAIAdapter<T>(preset: OpenAICompatConfig, ctor: OpenAIConstructor<T>): T;
export function buildOpenAIAdapter<T>(
  preset: OpenAICompatConfig,
  ctor?: OpenAIConstructor<T>,
): OpenAICompatConfig | T {
  if (ctor === undefined) return preset;
  return new ctor(preset);
}

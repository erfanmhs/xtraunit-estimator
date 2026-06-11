/**
 * Anthropic Claude client — SERVER ONLY.
 *
 * The first line, `import "server-only"`, is a safety guard: if anyone ever
 * accidentally imports this file into browser code, the build will fail on
 * purpose. That keeps your secret ANTHROPIC_API_KEY from ever being shipped to
 * a user's browser.
 *
 * Use `getAnthropicClient()` inside API routes or server actions to talk to
 * Claude. It throws a clear error if the API key hasn't been set yet, instead
 * of failing in a confusing way later.
 *
 * The API key is read from the ANTHROPIC_API_KEY environment variable
 * (see .env.local.example).
 */
import "server-only";
import Anthropic from "@anthropic-ai/sdk";

/**
 * Default Claude model for the app. Change this in one place to upgrade the
 * whole app to a different model later.
 */
export const CLAUDE_MODEL = "claude-sonnet-4-6";

let client: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to your .env.local file. See README.md for instructions.",
    );
  }

  // Reuse a single client instance instead of creating a new one every call.
  if (!client) {
    client = new Anthropic({ apiKey });
  }

  return client;
}

import type { RunInput } from "@agencymem/contracts";

/** Each error carries the Runs made before it, so a failed work item still records its usage. */
abstract class ModelError extends Error {
  runs: RunInput[] = [];
}

/** Both endpoints failed (network, timeout, 429 or 5xx after the retries). The runner fails the
 * item with "model unavailable" (agent-prompts.md, Act-step failures). */
export class ModelUnavailableError extends ModelError {
  override name = "ModelUnavailableError";
}

/** An HTTP 4xx other than 429: the request is wrong, so there is no fallback. */
export class ModelRequestError extends ModelError {
  override name = "ModelRequestError";
  constructor(
    message: string,
    readonly status: number | undefined,
  ) {
    super(message);
  }
}

/** The agent's own check threw (the Test agent's git or file work), not the model's reply. The
 * runner fails the item with the message; retrying would pay for the same reply again. */
export class ModelCheckError extends ModelError {
  override name = "ModelCheckError";
}

/** The reply failed its checks twice: once, and again after the one repair. */
export class ModelOutputError extends ModelError {
  override name = "ModelOutputError";
  constructor(readonly errors: string[]) {
    super(`The model's JSON failed its checks after one repair: ${errors.join("; ")}`);
  }
}

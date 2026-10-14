import { reject, type GuardResult } from "./run";

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
const URL_ = /\bhttps?:\/\/\S+|\bwww\.\S+/i;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Rejects text bound for the agency graph that still holds a client name (the project's Entity
 * names and aliases, matched as whole words, any case), an email address or a URL.
 */
export function anonymity(texts: string[], names: string[]): GuardResult | null {
  const known = names.map((n) => n.trim()).filter((n) => n.length >= 2);
  for (const text of texts) {
    const name = known.find((n) => new RegExp(`(?<!\\w)${escape(n)}(?!\\w)`, "i").test(text));
    if (name) {
      return reject("anonymity", "NAME_FOUND", "The text names the client.", { match: name });
    }
    const email = EMAIL.exec(text);
    if (email) {
      return reject("anonymity", "EMAIL_FOUND", "The text holds an email address.", {
        match: email[0],
      });
    }
    const url = URL_.exec(text);
    if (url) {
      return reject("anonymity", "URL_FOUND", "The text holds a URL.", { match: url[0] });
    }
  }
  return null;
}

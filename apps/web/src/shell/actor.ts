// The actor name behind X-AM-Actor (ui.md section 2): a name field, kept in localStorage, default
// "lead". Storage can be missing or blocked; the default then holds.
const KEY = "agencymem.actor";

export function getActor(): string {
  try {
    return localStorage.getItem(KEY)?.trim() || "lead";
  } catch {
    return "lead";
  }
}

export function setActor(name: string): void {
  try {
    localStorage.setItem(KEY, name.trim());
  } catch {
    // the name lasts until the page reloads
  }
}

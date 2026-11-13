import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// the daemon's "version" = a hash of the source it runs. the daemon computes it ONCE at boot (= what it
// loaded); the app computes it from disk on launch (= what's there now). different → daemon runs stale code.
// auto, not a hand-bumped constant: forgetting to bump is how we shipped a size fix the daemon never ran.
const DAEMON_SOURCES = ["daemon.ts", "pens.ts", "version.ts"];

export function codeVersion(): string {
	const h = createHash("sha256");
	for (const f of DAEMON_SOURCES) h.update(readFileSync(join(import.meta.dirname, f)));
	return h.digest("hex").slice(0, 12);
}

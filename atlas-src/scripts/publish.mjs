/**
 * Copies the Next.js static export (./out) to ../atlas, which is the path the
 * repository root is published from. Run automatically after `next build`.
 */
import { cp, rm, access, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const source = path.join(root, "out");
const target = path.resolve(root, "..", "atlas");

try {
  await access(source);
} catch {
  console.error(`publish: no export found at ${source} — run \`next build\` first.`);
  process.exit(1);
}

await rm(target, { recursive: true, force: true });
await cp(source, target, { recursive: true });

const entries = await readdir(target);
console.log(`publish: ${entries.length} entries copied to ${target}`);

import { strict as assert } from "node:assert";
import { IdentityFilter, sanitizeIdentity } from "../lib/identity";

// Feed text in small chunks, as the stream does.
function stream(text: string, size = 17): string {
  const f = new IdentityFilter();
  let out = "";
  for (let i = 0; i < text.length; i += size) out += f.push(text.slice(i, i + size));
  out += f.flush();
  return out;
}

// 1. Prose is rewritten.
const prose = "I am Gemini, created by Google.";
assert.equal(stream(prose).includes("Mino"), true, "prose should be rewritten");
assert.equal(stream(prose).includes("Gemini"), false, "vendor name should be gone from prose");

// 2. Code inside a fence is NOT touched.
const code = "Here is a snippet:\n```python\n# I am Gemini, created by Google\nx = 'I am Gemini'\n```\nAnd I am Gemini, created by Google.";
const out = stream(code);
assert.equal(out.includes("# I am Gemini, created by Google"), true, "comment in code must be untouched");
assert.equal(out.includes("x = 'I am Gemini'"), true, "string in code must be untouched");
assert.equal(out.split("\n").pop()!.includes("Mino"), true, "prose after the fence must still be rewritten");

// 3. Tilde fence is honoured too.
const tilde = "~~~\nI am Gemini\n~~~\nI am Gemini";
const tout = stream(tilde);
assert.equal(tout.includes("I am Gemini\n~~~"), true, "tilde-fenced content untouched");
assert.equal(tout.trim().endsWith("Mino"), true, "prose after tilde fence rewritten");

// 4. An info string inside a fence does not close it.
const info = "```ts\n// I am Gemini\nconst a = 1;\n```\nI am Gemini";
const iout = stream(info);
assert.equal(iout.includes("// I am Gemini"), true, "comment preserved");
assert.equal(iout.trim().endsWith("Mino"), true, "closed properly then rewritten");

// 5. Unclosed fence: everything after the opener is left alone (never corrupt code).
const unclosed = "I am Gemini\n```\nI am Gemini";
const uout = stream(unclosed);
assert.equal(uout.split("\n")[2].includes("I am Gemini"), true, "content in unclosed fence preserved");

// 6. Inline code spans still get rewritten (documented tradeoff, prose-first).
// Just assert it doesn't crash.
sanitizeIdentity("I am Gemini");

console.log("identity fence tests: ALL PASSED");

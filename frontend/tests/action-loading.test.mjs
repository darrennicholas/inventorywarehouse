import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const intentSource = await readFile(new URL("../src/lib/action-intent.ts", import.meta.url), "utf8");
const intentUrl = `data:text/javascript;base64,${Buffer.from(intentSource).toString("base64")}`;
const intent = await import(intentUrl);
const apiSource = await readFile(new URL("../src/lib/api.ts", import.meta.url), "utf8");
const apiJs = ts.transpileModule(apiSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace('"@/lib/action-intent"', JSON.stringify(intentUrl));
const api = await import(`data:text/javascript;base64,${Buffer.from(apiJs).toString("base64")}`);

test("tracks explicit actions and clears intent for navigation", () => {
  const previousWindow = globalThis.window;
  const previousNow = Date.now;
  globalThis.window = new EventTarget();
  let now = 1000; Date.now = () => now;
  let navigationEvents = 0; window.addEventListener("stockflow:action-navigation", () => navigationEvents++);
  try {
    assert.equal(intent.hasActionIntent(), false);
    intent.markActionIntent(); assert.equal(intent.hasActionIntent(), true);
    now += 251; assert.equal(intent.hasActionIntent(), false);
    intent.markActionIntent(true); now += 1000; assert.equal(intent.hasActionIntent(), true);
    intent.clearActionIntent(); assert.equal(intent.hasActionIntent(), false); assert.equal(navigationEvents, 1);
  } finally { Date.now = previousNow; globalThis.window = previousWindow; }
});

test("API requests finish the action indicator on success and failure", async () => {
  const previousWindow = globalThis.window; const previousFetch = globalThis.fetch;
  const previousNow = Date.now;
  globalThis.window = new EventTarget();
  const events = []; window.addEventListener("stockflow:action-request", (event) => events.push(event.detail));
  try {
    let now = 1000; Date.now = () => now;
    let complete;
    globalThis.fetch = () => new Promise((resolve) => { complete = resolve; });
    intent.markActionIntent(); const request = api.apiRequest("/api/example", { method: "POST" });
    now += 1000; assert.equal(intent.hasActionIntent(), false);
    complete(new Response('{"success":true}', { status: 200 })); await request;
    assert.equal(intent.hasActionIntent(), true, "follow-up refresh can remain associated with the action");
    assert.deepEqual(events.map((event) => event.phase), ["start", "end"]);
    assert.ok(events.every((event) => event.userInitiated)); assert.equal(events[0].id, events[1].id);
    events.length = 0; intent.clearActionIntent(); globalThis.fetch = async () => new Response('{"success":true}', { status: 200 }); await api.apiRequest("/api/background");
    assert.ok(events.every((event) => !event.userInitiated));
    events.length = 0; intent.markActionIntent(); globalThis.fetch = async () => { throw new Error("offline"); };
    await assert.rejects(api.apiDownload("/api/example.csv"));
    assert.deepEqual(events.map((event) => event.phase), ["start", "end"]);
    assert.ok(events.every((event) => event.userInitiated));
  } finally { intent.clearActionIntent(); Date.now = previousNow; globalThis.fetch = previousFetch; globalThis.window = previousWindow; }
});

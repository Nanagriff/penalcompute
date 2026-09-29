import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const QUEUE_KEY = "computation.usage.queue";

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
}

interface Sent { url: string; body: any }

let storage: MemoryStorage;
let sent: Sent[];
let status: number;
let online: boolean;
let listeners: Record<string, Array<() => void>>;

async function load() {
  vi.resetModules();
  return await import("../usageClient");
}

const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  storage = new MemoryStorage();
  sent = [];
  status = 201;
  online = true;
  listeners = {};
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("navigator", { get onLine() { return online; } });
  vi.stubGlobal("window", {
    matchMedia: () => ({ matches: false }),
    addEventListener: (name: string, fn: () => void) => { (listeners[name] ??= []).push(fn); },
  });
  vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
    if (!online) throw new TypeError("network");
    sent.push({ url, body: JSON.parse(init.body) });
    return { ok: status >= 200 && status < 300, status };
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("usage counts", () => {
  it("sends the kind of computation, the time and the versions, and nothing else", async () => {
    const { recordUse } = await load();
    recordUse("simple", true);
    await settle();
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe("/usage");
    expect(Object.keys(sent[0].body).sort()).toEqual(["device_id", "events", "installed"]);
    expect(sent[0].body.events).toHaveLength(1);
    const e = sent[0].body.events[0];
    expect(Object.keys(e).sort()).toEqual(
      ["at", "build_date", "engine_version", "offline", "ok", "ruleset_version", "scenario"],
    );
    expect(e.scenario).toBe("simple");
    expect(e.ok).toBe(true);
    expect(e.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(storage.getItem(QUEUE_KEY)).toBeNull();
  });

  it("keeps one random device id and reuses it", async () => {
    const { recordUse, deviceId } = await load();
    const id = deviceId();
    expect(id).toMatch(/^[A-Za-z0-9-]{8,64}$/);
    recordUse("simple", true);
    await settle();
    recordUse("hospital", true);
    await settle();
    expect(sent.map((s) => s.body.device_id)).toEqual([id, id]);
    const again = await load();
    expect(again.deviceId()).toBe(id);
  });

  it("holds counts made offline and sends them together when the network returns", async () => {
    online = false;
    const { recordUse } = await load();
    recordUse("simple", true);
    recordUse("reduction", false);
    await settle();
    expect(sent).toHaveLength(0);
    expect(JSON.parse(storage.getItem(QUEUE_KEY)!)).toHaveLength(2);

    online = true;
    listeners.online.forEach((fn) => fn());
    await settle();
    expect(sent).toHaveLength(1);
    expect(sent[0].body.events.map((e: any) => [e.scenario, e.ok, e.offline])).toEqual([
      ["simple", true, true],
      ["reduction", false, true],
    ]);
    expect(storage.getItem(QUEUE_KEY)).toBeNull();
  });

  it("sends what an earlier session left behind", async () => {
    online = false;
    const first = await load();
    first.recordUse("counts", true);
    await settle();
    online = true;
    const second = await load();
    second.startUsage();
    await settle();
    expect(sent).toHaveLength(1);
    expect(sent[0].body.events[0].scenario).toBe("counts");
  });

  it("keeps the counts when the server is busy, drops them when it refuses them", async () => {
    const { recordUse, flushUsage } = await load();
    status = 429;
    recordUse("simple", true);
    await settle();
    expect(JSON.parse(storage.getItem(QUEUE_KEY)!)).toHaveLength(1);
    status = 503;
    await flushUsage();
    expect(JSON.parse(storage.getItem(QUEUE_KEY)!)).toHaveLength(1);
    status = 422;
    await flushUsage();
    expect(storage.getItem(QUEUE_KEY)).toBeNull();
  });

  it("sends a long queue in batches of 100 and never holds more than 500", async () => {
    online = false;
    const { recordUse } = await load();
    for (let i = 0; i < 520; i++) recordUse("simple", true);
    expect(JSON.parse(storage.getItem(QUEUE_KEY)!)).toHaveLength(500);
    online = true;
    listeners.online.forEach((fn) => fn());
    await settle();
    await settle();
    expect(sent.map((s) => s.body.events.length)).toEqual([100, 100, 100, 100, 100]);
    expect(storage.getItem(QUEUE_KEY)).toBeNull();
  });

  it("never throws when storage is blocked", async () => {
    vi.stubGlobal("localStorage", {
      getItem() { throw new Error("blocked"); },
      setItem() { throw new Error("blocked"); },
      removeItem() { throw new Error("blocked"); },
    });
    const { recordUse, deviceId } = await load();
    expect(() => recordUse("simple", true)).not.toThrow();
    expect(deviceId()).toBe(deviceId());
    await settle();
  });
});

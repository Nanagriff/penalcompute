import { describe, expect, it } from "vitest";
import { platform, SNOOZE_DAYS, snoozed } from "../install";

const DAY = 86_400_000;

describe("platform", () => {
  it("spots iPhone and iPad", () => {
    expect(platform("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1")).toBe("ios");
    expect(platform("Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X)")).toBe("ios");
  });
  it("treats a touch Macintosh as iPadOS, a plain one as other", () => {
    const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15";
    expect(platform(mac, 5)).toBe("ios");
    expect(platform(mac, 0)).toBe("other");
  });
  it("spots Android, including Samsung Internet", () => {
    expect(platform("Mozilla/5.0 (Linux; Android 13; SM-A135F) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36")).toBe("android");
    expect(platform("Mozilla/5.0 (Linux; Android 12; SAMSUNG SM-A125F) SamsungBrowser/23.0 Chrome/115 Mobile")).toBe("android");
  });
  it("is other for desktop browsers", () => {
    expect(platform("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120")).toBe("other");
    expect(platform("Mozilla/5.0 (X11; Linux x86_64) Firefox/121")).toBe("other");
  });
});

describe("snoozed", () => {
  const now = 1_800_000_000_000;
  it("is false with nothing stored or with rubbish", () => {
    expect(snoozed(null, now)).toBe(false);
    expect(snoozed("", now)).toBe(false);
    expect(snoozed("yesterday", now)).toBe(false);
  });
  it("hides the prompt for two weeks after Not now", () => {
    expect(snoozed(String(now - 1 * DAY), now)).toBe(true);
    expect(snoozed(String(now - (SNOOZE_DAYS - 1) * DAY), now)).toBe(true);
    expect(snoozed(String(now - SNOOZE_DAYS * DAY), now)).toBe(false);
    expect(snoozed(String(now - 60 * DAY), now)).toBe(false);
  });
});

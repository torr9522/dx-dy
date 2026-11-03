import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("apps/web/src/style.css", "utf8");

const token = (scope: string, name: string) => {
  const block = css.match(
    new RegExp(`${scope.replace(".", "\\.")}\\s*\\{([\\s\\S]*?)\\}`),
  );
  const value = block?.[1].match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1];
  if (!value) throw new Error(`Missing ${scope} --${name}`);
  return value.trim().toLowerCase();
};

const luminance = (hex: string) => {
  const channels = hex
    .slice(1)
    .match(/../g)!
    .map((value) => Number.parseInt(value, 16) / 255)
    .map((value) =>
      value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    );
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
};

const contrast = (foreground: string, background: string) => {
  const values = [luminance(foreground), luminance(background)].sort(
    (a, b) => b - a,
  );
  return (values[0] + 0.05) / (values[1] + 0.05);
};

describe("v0.3.6 light blue theme", () => {
  it("uses shared light and dark blue brand tokens", () => {
    expect(token(":root", "bg")).toBe("#f5f8fc");
    expect(token(":root", "surface")).toBe("#fff");
    expect(token(":root", "accent")).toBe("#2563eb");
    expect(token(":root", "accent-soft")).toBe("#eaf2ff");
    expect(token(":root.dark", "accent")).toBe("#60a5fa");
    expect(token(":root.dark", "accent-soft")).toBe("#1e3352");
  });

  it("removes the legacy green brand palette while retaining semantic errors", () => {
    for (const legacy of ["#078b82", "#07776f", "#48cabb", "#203e3c"])
      expect(css.toLowerCase()).not.toContain(legacy);
    expect(css.toLowerCase()).toContain("#c94a52");
    expect(css.toLowerCase()).toContain("#cc5c64");
  });

  it("keeps normal light-theme text and primary actions at WCAG AA contrast", () => {
    expect(contrast("#24324a", "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#24324a", "#f5f8fc")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#5f6f85", "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#5f6f85", "#eaf2ff")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#ffffff", "#2563eb")).toBeGreaterThanOrEqual(4.5);
  });
});

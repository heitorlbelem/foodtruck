import { describe, expect, it } from "vitest";

import { suggestedPriceCents } from "./combos.ts";

describe("suggestedPriceCents", () => {
  it("suggests the sum of the component prices times quantity", () => {
    expect(
      suggestedPriceCents([
        { quantity: 1, price_cents: 2500 },
        { quantity: 1, price_cents: 1200 },
        { quantity: 2, price_cents: 700 },
      ]),
    ).toBe(5100);
  });

  it("suggests zero for no components", () => {
    expect(suggestedPriceCents([])).toBe(0);
  });
});

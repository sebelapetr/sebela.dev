import { describe, expect, it } from "vitest";

import { explorationStatusText } from "./exploration-status";

describe("explorationStatusText", () => {
  it("names each stored status and what it means, never stronger than stored", () => {
    expect(explorationStatusText("built")).toEqual({
      label: "Built",
      meaning: "Implemented and working",
    });
    expect(explorationStatusText("tested")).toEqual({
      label: "Tested",
      meaning: "Tried hands-on",
    });
    expect(explorationStatusText("designed")).toEqual({
      label: "Designed",
      meaning: "Unimplemented design, planned or architected only",
    });
  });
});

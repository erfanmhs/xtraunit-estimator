import { describe, expect, it } from "vitest";
import { GUIDE, JOURNEY, guideFor, guideHref } from "./content";

const P = "00ebb408-178c-40f6-a91c-485b3b6f72e3";

describe("guideFor — which guide a route gets", () => {
  it("maps every project page to its stage", () => {
    expect(guideFor(`/projects/${P}`)).toEqual({ key: "project", projectId: P });
    expect(guideFor(`/projects/${P}/plans/abc`)).toEqual({ key: "takeoff", projectId: P });
    expect(guideFor(`/projects/${P}/scope`)).toEqual({ key: "scope", projectId: P });
    expect(guideFor(`/projects/${P}/pricing`)).toEqual({ key: "pricing", projectId: P });
    expect(guideFor(`/projects/${P}/estimate`)).toEqual({ key: "estimate", projectId: P });
    expect(guideFor(`/projects/${P}/proposal`)).toEqual({ key: "proposal", projectId: P });
  });
  it("keeps /projects/new out of the project regex", () => {
    expect(guideFor("/projects/new")).toEqual({ key: "new", projectId: null });
    expect(guideFor("/projects")).toEqual({ key: "projects", projectId: null });
  });
  it("covers the two other areas and falls back to projects", () => {
    expect(guideFor("/cost-database").key).toBe("cost-database");
    expect(guideFor("/settings").key).toBe("settings");
    expect(guideFor("/something-else").key).toBe("projects");
  });
});

describe("guideHref — where a guide key lives", () => {
  it("links stages to their pages inside a project", () => {
    expect(guideHref("scope", P)).toBe(`/projects/${P}/scope`);
    expect(guideHref("takeoff", P)).toBe(`/projects/${P}`); // hub knows the plan id
    expect(guideHref("scope", null)).toBeNull();
  });
});

describe("content hygiene", () => {
  it("every journey stage has an entry with steps and a done line", () => {
    for (const j of JOURNEY) {
      const e = GUIDE[j.key];
      expect(e.steps.length).toBeGreaterThan(0);
      expect(e.done.length).toBeGreaterThan(10);
    }
  });
  it("every next pointer names a real entry", () => {
    for (const e of Object.values(GUIDE)) if (e.next) expect(GUIDE[e.next.key]).toBeDefined();
  });
});

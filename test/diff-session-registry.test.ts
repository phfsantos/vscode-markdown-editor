import { describe, expect, test } from "vitest";
import { DiffSessionRegistry, type DiffSideFacts } from "../src/diff/DiffSessionRegistry";

type Panel = { instanceId: string };
const panel = (instanceId: string): Panel => ({ instanceId });
const file = (path: string): DiffSideFacts => ({ uri: `file://${path}`, writable: true });
const git = (path: string): DiffSideFacts => ({ uri: `git:${path}?{"ref":"HEAD"}`, writable: false });

function pair(order: Array<[Panel, DiffSideFacts]>, column = 1, registry = new DiffSessionRegistry<Panel>()) {
  for (const [p, facts] of order) registry.join(p, column, facts);
  return registry;
}

describe("DiffSessionRegistry", () => {
  for (const order of ["original-first", "modified-first"] as const) {
    test(`a Git working-tree diff puts the git: side left when ${order}`, () => {
      const original = panel("orig");
      const modified = panel("mod");
      const sides: Array<[Panel, DiffSideFacts]> = [[original, git("/w/diff.md")], [modified, file("/w/diff.md")]];
      const registry = pair(order === "original-first" ? sides : sides.reverse());
      expect(registry.roleOf(original)).toBe("left");
      expect(registry.roleOf(modified)).toBe("right");
      expect(registry.partnerOf(original)).toBe(modified);
      expect(registry.sessionOf(original)?.basis).toBe("writability");
    });

    test(`a read-only file system side is the original when ${order}`, () => {
      const original = panel("snapshot");
      const modified = panel("mod");
      const sides: Array<[Panel, DiffSideFacts]> = [[original, { uri: "chat-editing-snapshot-text-model:/w/a.md", writable: false }], [modified, file("/w/a.md")]];
      const registry = pair(order === "original-first" ? sides : sides.reverse());
      expect(registry.roleOf(original)).toBe("left");
      expect(registry.roleOf(modified)).toBe("right");
    });
  }

  test("two writable same-named files fall back to resolve order (modified resolves first) and say so", () => {
    const modified = panel("right");
    const original = panel("left");
    const registry = pair([[modified, file("/w/compare/right/diff.md")], [original, file("/w/compare/left/diff.md")]]);
    expect(registry.roleOf(original)).toBe("left");
    expect(registry.roleOf(modified)).toBe("right");
    expect(registry.sessionOf(modified)?.basis).toBe("resolve-order");
  });

  test("sides never depend on a tab label: the registry is never given one", () => {
    expect(DiffSessionRegistry.prototype.join.length).toBe(3);
  });

  test("diffs in different columns form separate sessions with stable ids", () => {
    const registry = new DiffSessionRegistry<Panel>();
    const a1 = panel("a1"); const a2 = panel("a2"); const b1 = panel("b1"); const b2 = panel("b2");
    registry.join(a1, 1, git("/w/a.md"));
    registry.join(b1, 2, git("/w/b.md"));
    registry.join(a2, 1, file("/w/a.md"));
    registry.join(b2, 2, file("/w/b.md"));
    expect(registry.partnerOf(a1)).toBe(a2);
    expect(registry.partnerOf(b1)).toBe(b2);
    const id = registry.sessionOf(a1)!.id;
    expect(registry.sessionOf(a2)!.id).toBe(id);
    expect(registry.sessionOf(b1)!.id).not.toBe(id);
  });

  test("a third editor in the same column starts a new session instead of joining a full one", () => {
    const registry = pair([[panel("o"), git("/w/a.md")], [panel("m"), file("/w/a.md")]]);
    const extra = panel("x");
    registry.join(extra, 1, file("/w/other.md"));
    expect(registry.partnerOf(extra)).toBeUndefined();
    expect(registry.roleOf(extra)).toBeUndefined();
  });

  test("leaving removes only that side; a re-resolved side pairs with the survivor (S3)", () => {
    const original = panel("orig");
    const modified = panel("mod");
    const registry = pair([[modified, file("/w/diff.md")], [original, git("/w/diff.md")]]);
    const id = registry.sessionOf(modified)!.id;
    registry.leave(original);
    expect(registry.sessionOf(original)).toBeUndefined();
    expect(registry.sessionOf(modified)?.id).toBe(id);
    expect(registry.partnerOf(modified)).toBeUndefined();
    const reopened = panel("orig-2");
    registry.join(reopened, 1, git("/w/diff.md"));
    expect(registry.partnerOf(modified)).toBe(reopened);
    expect(registry.roleOf(reopened)).toBe("left");
    expect(registry.sessionOf(reopened)?.id).toBe(id);
  });

  test("the last side leaving deletes the session", () => {
    const a = panel("a"); const b = panel("b");
    const registry = pair([[a, git("/w/x.md")], [b, file("/w/x.md")]]);
    registry.leave(a);
    registry.leave(b);
    expect(registry.size).toBe(0);
  });
});

describe("two writable files: the side VS Code focuses on open is the modified one", () => {
  for (const order of ["original-first", "modified-first"] as const) {
    test(`activation fixes the sides when ${order}`, () => {
      const original = panel("left-file");
      const modified = panel("right-file");
      const sides: Array<[Panel, DiffSideFacts]> = [[original, file("/w/compare/left/diff.md")], [modified, file("/w/compare/right/diff.md")]];
      const registry = pair(order === "original-first" ? sides : [...sides].reverse());
      registry.noteActivated(modified);
      expect(registry.roleOf(original)).toBe("left");
      expect(registry.roleOf(modified)).toBe("right");
      expect(registry.sessionOf(original)?.basis).toBe("active-side");
    });
  }

  test("the first activation decides; later focus changes never swap sides", () => {
    const original = panel("o");
    const modified = panel("m");
    const registry = pair([[original, file("/w/a/x.md")], [modified, file("/w/b/x.md")]]);
    expect(registry.noteActivated(modified)).toBe(true);
    expect(registry.noteActivated(original)).toBe(false);
    expect(registry.roleOf(modified)).toBe("right");
  });

  test("activation never overrides a writability decision", () => {
    const original = panel("git");
    const modified = panel("file");
    const registry = pair([[original, git("/w/x.md")], [modified, file("/w/x.md")]]);
    expect(registry.noteActivated(original)).toBe(false);
    expect(registry.roleOf(original)).toBe("left");
  });

  test("an activation before the partner joins is remembered", () => {
    const registry = new DiffSessionRegistry<Panel>();
    const modified = panel("m");
    const original = panel("o");
    registry.join(modified, 1, file("/w/b/x.md"));
    registry.noteActivated(modified);
    registry.join(original, 1, file("/w/a/x.md"));
    expect(registry.roleOf(modified)).toBe("right");
    expect(registry.sessionOf(modified)?.basis).toBe("active-side");
  });
});

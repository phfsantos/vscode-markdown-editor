import { expect, test } from "vitest";
import { anchorAt, scrollTopFor, type RowBox } from "../packages/media/src/diff/scroll-sync";

// Rows of uneven height, with a gap row (4) only this pane draws as a ghost.
const boxes: RowBox[] = [
  { row: 0, top: 0, height: 20 },
  { row: 1, top: 20, height: 40 },
  { row: 2, top: 60, height: 20 },
  { row: 4, top: 80, height: 30 },
  { row: 5, top: 110, height: 20 },
];

test("an anchor is the aligned row at the viewport top plus the fraction scrolled into it", () => {
  expect(anchorAt(boxes, 0)).toEqual({ row: 0, offset: 0 });
  expect(anchorAt(boxes, 30)).toEqual({ row: 1, offset: 0.25 });
  expect(anchorAt(boxes, 95)).toEqual({ row: 4, offset: 0.5 });
  expect(anchorAt(boxes, 500)).toEqual({ row: 5, offset: 1 });
  expect(anchorAt([], 10)).toBeNull();
});

test("applying an anchor lands on the same row in a pane whose rows have other heights", () => {
  const other: RowBox[] = boxes.map((box) => ({ ...box, top: box.top * 2, height: box.height * 2 }));
  for (const top of [0, 30, 65, 95, 115]) {
    const anchor = anchorAt(boxes, top)!;
    const target = scrollTopFor(other, anchor)!;
    expect(anchorAt(other, target)).toEqual(anchor);
  }
});

test("a row the follower lacks resolves to the end of the closest earlier row", () => {
  expect(scrollTopFor(boxes, { row: 3, offset: 0.5 })).toBe(80);
});

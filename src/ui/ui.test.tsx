import { renderToStaticMarkup as html } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { Button, Toggle } from "./Button";
import { STATUS_LETTER, STATUS_TITLE, cx, splitDisplayPath, thumbInsets } from "./classes";
import { Banner } from "./Feedback";
import { Checkbox, Field } from "./Field";
import { Badge, Chip, Mark, StateTag } from "./Status";
import { Row } from "./Structure";
import { Tray } from "./Tray";

describe("cx", () => {
  test("keeps only the names that are set", () => expect(cx("a", false, null, undefined, "", "b")).toBe("a b"));
});

describe("thumbInsets", () => {
  test("measures from both edges of the tray", () => expect(thumbInsets(120, 40, 50)).toEqual({ left: 40, right: 30 }));
});

describe("splitDisplayPath", () => {
  test("keeps the folder's slash", () => expect(splitDisplayPath("src/a/b.ts")).toEqual({ dir: "src/a/", name: "b.ts" }));
  test("a file at the root has no folder", () => expect(splitDisplayPath("b.ts")).toEqual({ dir: "", name: "b.ts" }));
});

describe("status letters", () => {
  test("every kind has a letter and a title", () => expect(Object.keys(STATUS_LETTER).sort()).toEqual(Object.keys(STATUS_TITLE).sort()));
  test("a real conflict reads !", () => expect(STATUS_LETTER.conflicted).toBe("!"));
});

describe("Button", () => {
  test("a disabled button stays focusable and shows its reason", () => {
    const out = html(<Button text="Push" disabled="Nothing to push" />);
    expect(out).toContain('aria-disabled="true"');
    expect(out).toContain('data-tip="Nothing to push"');
    expect(out).not.toMatch(/\sdisabled(=|\s|>)/);
  });
  test("a disabled or loading button does not run", () => {
    const run = vi.fn();
    const handler = (o: object) => (Button(o as Parameters<typeof Button>[0]) as { props: { onClick?: () => void } }).props.onClick;
    expect(handler({ text: "a", disabled: "no", onClick: run })).toBeUndefined();
    expect(handler({ text: "a", loading: true, onClick: run })).toBeUndefined();
    expect(handler({ text: "a", onClick: run })).toBe(run);
  });
  test("an icon alone is named by its label", () => {
    const out = html(<Button icon="sync" label="Refresh" />);
    expect(out).toContain('aria-label="Refresh"');
    expect(out).toContain("only");
  });
  test("loading swaps the icon for a spinner", () => expect(html(<Button icon="sync" text="Push" loading />)).toContain('class="spin"'));
});

describe("Toggle", () => {
  test("says whether it is pressed", () => {
    expect(html(<Toggle text="a" on />)).toContain('aria-pressed="true"');
    expect(html(<Toggle text="a" />)).toContain('aria-pressed="false"');
  });
  test("the blue tone is the changes tone", () => expect(html(<Toggle text="a" on tone="changes" />)).toContain("tone-changes"));
});

describe("Tray", () => {
  const items = [["a", "One"], ["b", "Two", "Unavailable"]] as const;
  test("views are tabs", () => {
    const out = html(<Tray label="Demo" value="a" items={items} role="tablist" />);
    expect(out).toContain('role="tablist"');
    expect(out).toContain('aria-selected="true"');
  });
  test("a choice is a pressed group", () => expect(html(<Tray label="Demo" value="a" items={items} />)).toContain('aria-pressed="true"'));
  test("a disabled item gives its reason", () => expect(html(<Tray label="Demo" value="a" items={items} />)).toContain('data-tip="Unavailable"'));
});

describe("Field", () => {
  test("the placeholder names a field without a label", () => expect(html(<Field placeholder="Filter" readOnly />)).toContain('aria-label="Filter"'));
  test("invalid is announced", () => expect(html(<Field label="a" invalid readOnly />)).toContain('aria-invalid="true"'));
  test("a plain field has no wrapper", () => expect(html(<Field label="a" readOnly />)).not.toContain("field-w"));
  test("search brings the wrapper and its icon", () => expect(html(<Field label="a" search readOnly />)).toContain("has-ic"));
});

describe("Checkbox", () => {
  test("uses its label when it has no text", () => expect(html(<Checkbox label="Minimap" readOnly />)).toContain('aria-label="Minimap"'));
});

describe("Mark", () => {
  test("carries every state's glyph so the change crossfades", () => {
    const out = html(<Mark state="idle" />);
    for (const g of ["m-live", "m-changes", "m-error", "m-idle"]) expect(out).toContain(g);
    expect(out).toContain('data-s="idle"');
  });
});

describe("StateTag", () => {
  test("only Push rejected is a filled badge", () => {
    expect(html(<StateTag state="error" label="Push rejected" />)).toContain("badge error");
    for (const s of ["active", "changes", "idle"] as const) expect(html(<StateTag state={s} label="x" />)).not.toContain("badge");
  });
});

describe("Badge", () => {
  test("possible conflict uses the warn tone", () => expect(html(<Badge tone="warn">2</Badge>)).toContain("badge warn"));
});

describe("Chip", () => {
  test("is a button only when it does something", () => {
    expect(html(<Chip onClick={() => {}}>a</Chip>)).toContain("<button");
    expect(html(<Chip>a</Chip>)).not.toContain("<button");
  });
});

describe("Banner", () => {
  test("errors and warnings interrupt; notices do not", () => {
    expect(html(<Banner tone="error" text="a" />)).toContain('role="alert"');
    expect(html(<Banner tone="warn" text="a" />)).toContain('role="alert"');
    expect(html(<Banner text="Connection to dev-box lost. Reconnecting…" />)).toContain('role="status"');
  });
  test("raw git output keeps its lines", () => expect(html(<Banner tone="error" pre text={"a\nb"} />)).toContain("<pre>"));
  test("no dismiss button without a way to dismiss", () => expect(html(<Banner text="a" />)).not.toContain("Dismiss"));
});

describe("Row", () => {
  test("is selectable as an option", () => expect(html(<Row on>a</Row>)).toContain('aria-selected="true"'));
  test("other roles carry no selection", () => expect(html(<Row role="presentation">a</Row>)).not.toContain("aria-selected"));
  test("tree depth indents", () => expect(html(<Row indent={2}>a</Row>)).toContain("padding-left:34px"));
  test("a disabled row keeps its reason and does not run", () => {
    const run = vi.fn();
    const out = html(
      <Row disabled="Bare repository" onClick={run}>
        a
      </Row>,
    );
    expect(out).toContain('aria-disabled="true"');
    expect(out).toContain('data-tip="Bare repository"');
    expect((Row({ disabled: "no", onClick: run }) as { props: { onClick?: () => void } }).props.onClick).toBeUndefined();
  });
});

import { describe, it, expect } from "vitest";
import { readEditableText } from "../../js/editor.js";

function div(html) {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el;
}

describe("readEditableText", () => {
  it("reads plain text unchanged", () => {
    expect(readEditableText(div("hello world"))).toBe("hello world");
  });

  it("treats <br> as a newline", () => {
    expect(readEditableText(div("line one<br>line two"))).toBe("line one\nline two");
  });

  it("treats <div> blocks as newline-separated lines", () => {
    expect(readEditableText(div("line one<div>line two</div>"))).toBe(
      "line one\nline two",
    );
  });

  it("does not double up newlines across <div> and <br>", () => {
    expect(readEditableText(div("a<div>b</div><div>c</div>"))).toBe("a\nb\nc");
  });

  it("converts non-breaking spaces to regular spaces", () => {
    expect(readEditableText(div("a b"))).toBe("a b");
  });

  it("strips a single trailing newline", () => {
    expect(readEditableText(div("a<br>"))).toBe("a");
  });

  it("reads nested elements recursively", () => {
    expect(readEditableText(div("a<span>b<br>c</span>"))).toBe("ab\nc");
  });
});

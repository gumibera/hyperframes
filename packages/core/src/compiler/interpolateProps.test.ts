import { describe, it, expect } from "vitest";
import { interpolateProps, interpolateScriptProps, parseVariableValues } from "./interpolateProps";

describe("parseVariableValues", () => {
  it("parses valid JSON object", () => {
    expect(parseVariableValues('{"title":"Hello","price":19}')).toEqual({
      title: "Hello",
      price: 19,
    });
  });

  it("returns null for null/undefined/empty", () => {
    expect(parseVariableValues(null)).toBeNull();
    expect(parseVariableValues(undefined)).toBeNull();
    expect(parseVariableValues("")).toBeNull();
  });

  it("returns null for non-object JSON", () => {
    expect(parseVariableValues('"just a string"')).toBeNull();
    expect(parseVariableValues("[1,2,3]")).toBeNull();
    expect(parseVariableValues("42")).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(parseVariableValues("{broken}")).toBeNull();
  });

  it("handles boolean values", () => {
    expect(parseVariableValues('{"featured":true}')).toEqual({ featured: true });
  });
});

describe("interpolateProps", () => {
  it("replaces {{key}} placeholders with values", () => {
    const result = interpolateProps('<div class="card"><h2>{{title}}</h2><p>{{price}}</p></div>', {
      title: "Pro Plan",
      price: "$19/mo",
    });
    expect(result).toBe('<div class="card"><h2>Pro Plan</h2><p>$19/mo</p></div>');
  });

  it("handles numeric values", () => {
    const result = interpolateProps("<span>{{count}} items</span>", { count: 42 });
    expect(result).toBe("<span>42 items</span>");
  });

  it("handles boolean values", () => {
    const result = interpolateProps("<span>Featured: {{featured}}</span>", { featured: true });
    expect(result).toBe("<span>Featured: true</span>");
  });

  it("preserves unmatched placeholders", () => {
    const result = interpolateProps("<span>{{title}} and {{unknown}}</span>", { title: "Hello" });
    expect(result).toBe("<span>Hello and {{unknown}}</span>");
  });

  it("handles whitespace in placeholder keys", () => {
    const result = interpolateProps("<span>{{ title }}</span>", { title: "Hello" });
    expect(result).toBe("<span>Hello</span>");
  });

  it("HTML-escapes values to prevent XSS", () => {
    const result = interpolateProps("<span>{{name}}</span>", {
      name: '<script>alert("xss")</script>',
    });
    expect(result).toBe("<span>&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;</span>");
  });

  it("escapes ampersands and quotes", () => {
    const result = interpolateProps('<div title="{{label}}">{{text}}</div>', {
      label: 'A & B "quoted"',
      text: "Tom & Jerry",
    });
    expect(result).toContain("A &amp; B &quot;quoted&quot;");
    expect(result).toContain("Tom &amp; Jerry");
  });

  it("returns original html when values is empty", () => {
    const html = "<div>{{title}}</div>";
    expect(interpolateProps(html, {})).toBe(html);
  });

  it("returns original html when html is empty", () => {
    expect(interpolateProps("", { title: "Hello" })).toBe("");
  });

  it("handles multiple occurrences of the same key", () => {
    const result = interpolateProps("{{name}} said {{name}}", { name: "Alice" });
    expect(result).toBe("Alice said Alice");
  });

  it("handles dotted keys", () => {
    const result = interpolateProps("{{card.title}}", { "card.title": "Premium" });
    expect(result).toBe("Premium");
  });
});

describe("interpolateScriptProps", () => {
  it("replaces placeholders without HTML escaping", () => {
    const result = interpolateScriptProps('const title = "{{title}}"; const dur = {{duration}};', {
      title: "My Video",
      duration: 10,
    });
    expect(result).toBe('const title = "My Video"; const dur = 10;');
  });

  it("preserves unmatched placeholders", () => {
    const result = interpolateScriptProps("const x = {{unknown}};", { title: "Hello" });
    expect(result).toBe("const x = {{unknown}};");
  });

  it("does not escape special characters in scripts", () => {
    const result = interpolateScriptProps('const s = "{{val}}";', { val: "A & B" });
    expect(result).toBe('const s = "A & B";');
  });
});

import { describe, expect, test } from "vitest";
import { buildArtifacts, resolveOutputDir, sniffExtension, writeArtifacts } from "./artifacts.js";

describe("sniffExtension", () => {
  test("markdown heading → md", () => {
    expect(sniffExtension("# Vue Weekly\n\nhello")).toBe("md");
  });

  test("markdown link → md", () => {
    expect(sniffExtension("see [the docs](https://vuejs.org) here")).toBe("md");
  });

  test("html → html", () => {
    expect(sniffExtension("<html><body>hi</body></html>")).toBe("html");
  });

  test("json object → json", () => {
    expect(sniffExtension('{"a":1}')).toBe("json");
  });

  test("plain prose → txt", () => {
    expect(sniffExtension("just some words without structure")).toBe("txt");
  });
});

describe("buildArtifacts", () => {
  test("undefined return value → null (nothing to show or persist)", () => {
    expect(buildArtifacts(undefined)).toBeNull();
  });

  test("always prints the return object pretty-printed to the terminal", () => {
    const set = buildArtifacts({ itemCount: 47 });
    expect(set?.terminal).toBe(JSON.stringify({ itemCount: 47 }, null, 2));
  });

  test("result.json holds the complete return value verbatim", () => {
    const value = { newsletter: "# Vue Weekly", itemCount: 47, curated: { highlights: ["a"] } };
    const set = buildArtifacts(value);
    const resultFile = set?.files.find((f) => f.name === "result.json");
    expect(resultFile?.content).toBe(JSON.stringify(value, null, 2));
  });

  test("each top-level string field is extracted to its own file", () => {
    const set = buildArtifacts({ newsletter: "# Vue Weekly\n\nhi", itemCount: 47 });
    const md = set?.files.find((f) => f.name === "newsletter.md");
    expect(md?.content).toBe("# Vue Weekly\n\nhi");
  });

  test("non-string fields are not extracted as standalone files", () => {
    const set = buildArtifacts({ newsletter: "# hi", itemCount: 47, curated: { a: 1 } });
    const names = set?.files.map((f) => f.name).sort();
    expect(names).toEqual(["newsletter.md", "result.json"]);
  });

  test("a bare string return value → output file plus result.json", () => {
    const set = buildArtifacts("# Just markdown");
    const names = set?.files.map((f) => f.name).sort();
    expect(names).toEqual(["output.md", "result.json"]);
    expect(set?.files.find((f) => f.name === "output.md")?.content).toBe("# Just markdown");
  });

  test("bare string terminal output is the raw string, not JSON-quoted", () => {
    const set = buildArtifacts("hello");
    expect(set?.terminal).toBe("hello");
  });
});

describe("resolveOutputDir", () => {
  test("undefined output → null (no persistence)", () => {
    expect(resolveOutputDir(undefined, "/home/me/proj")).toBeNull();
  });

  test("relative output is resolved against cwd", () => {
    expect(resolveOutputDir("./newsletters", "/home/me/proj")).toBe("/home/me/proj/newsletters");
  });

  test("a bare relative path without ./ is resolved against cwd", () => {
    expect(resolveOutputDir("out/news", "/home/me/proj")).toBe("/home/me/proj/out/news");
  });

  test("absolute output is used as-is", () => {
    expect(resolveOutputDir("/var/artifacts", "/home/me/proj")).toBe("/var/artifacts");
  });
});

describe("writeArtifacts", () => {
  test("writes every file under the target dir and returns their names", () => {
    const written = new Map<string, string>();
    const set = { files: [{ name: "newsletter.md", content: "# hi" }, { name: "result.json", content: "{}" }], terminal: "{}" };
    const names = writeArtifacts(set, "./newsletters", (path, content) => written.set(path, content));
    expect(written.get("./newsletters/newsletter.md")).toBe("# hi");
    expect(written.get("./newsletters/result.json")).toBe("{}");
    expect(names).toEqual(["newsletter.md", "result.json"]);
  });
});

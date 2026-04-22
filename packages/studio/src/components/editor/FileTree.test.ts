import { describe, expect, it } from "vitest";
import {
  buildMoveDestinationPath,
  buildStudioTreePaths,
  createPlaceholderPath,
  getDropPathData,
  isPendingCreateCleared,
} from "./FileTree";

describe("buildStudioTreePaths", () => {
  it("converts .gitkeep placeholders into visible folders", () => {
    expect(
      new Set(
        buildStudioTreePaths([
          "index.html",
          "assets/.gitkeep",
          "nested/empty/.gitkeep",
          "src/main.ts",
        ]),
      ),
    ).toEqual(new Set(["index.html", "assets/", "nested/empty/", "src/main.ts"]));
  });

  it("deduplicates repeated paths", () => {
    expect(buildStudioTreePaths(["assets/.gitkeep", "assets/.gitkeep", "assets/logo.png"])).toEqual(
      ["assets/", "assets/logo.png"],
    );
  });
});

describe("createPlaceholderPath", () => {
  it("creates unique file placeholders inside a folder", () => {
    expect(createPlaceholderPath(["src/untitled", "src/untitled-2"], "src", "file")).toBe(
      "src/untitled-3",
    );
  });

  it("creates unique folder placeholders at the root", () => {
    expect(createPlaceholderPath(["new-folder/", "new-folder-2/"], "", "folder")).toBe(
      "new-folder-3/",
    );
  });
});

describe("getDropPathData", () => {
  it("uses the hovered folder path", () => {
    expect(
      getDropPathData([
        { itemPath: "src/", itemType: "folder" },
        { itemPath: "src/index.ts", itemType: "file" },
      ]),
    ).toBe("src/");
  });

  it("falls back to a file parent path", () => {
    expect(
      getDropPathData([{ itemParentPath: "src/", itemPath: "src/index.ts", itemType: "file" }]),
    ).toBe("src/");
  });

  it("falls back to the root when there is no row target", () => {
    expect(getDropPathData([])).toBe("");
  });
});

describe("buildMoveDestinationPath", () => {
  it("builds a root move destination", () => {
    expect(buildMoveDestinationPath("src/index.ts", null)).toBe("index.ts");
  });

  it("builds a folder move destination for files and folders", () => {
    expect(buildMoveDestinationPath("src/index.ts", "assets/")).toBe("assets/index.ts");
    expect(buildMoveDestinationPath("src/components/", "assets/")).toBe("assets/components");
  });
});

describe("isPendingCreateCleared", () => {
  it("keeps pending creates alive across rename moves", () => {
    expect(
      isPendingCreateCleared(
        { operation: "move", from: "untitled", to: "record-note.html" },
        "untitled",
      ),
    ).toBe(false);
  });

  it("clears pending creates when the placeholder is removed", () => {
    expect(isPendingCreateCleared({ operation: "remove", path: "untitled" }, "untitled")).toBe(
      true,
    );
  });

  it("clears pending creates on model reset", () => {
    expect(isPendingCreateCleared({ operation: "reset" }, "untitled")).toBe(true);
  });
});

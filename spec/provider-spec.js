const fs = require("fs");
const path = require("path");

const temp = require("@lumine-code/temp");

describe("Lumine API autocompletions", () => {
  let [editor, provider] = [];
  const conditionPromise = async (condition, description = "condition") => {
    const startedAt = Date.now();
    while (true) {
      if (condition()) {
        return;
      }
      if (Date.now() - startedAt > 5000) {
        throw new Error(`Timed out waiting for ${description}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  };

  const getCompletions = function () {
    const cursor = editor.getLastCursor();
    const start = cursor.getBeginningOfCurrentWordBufferPosition();
    const end = cursor.getBufferPosition();
    const prefix = editor.getTextInRange([start, end]);
    const request = {
      editor,
      bufferPosition: end,
      scopeDescriptor: cursor.getScopeDescriptor(),
      prefix,
    };
    return provider.getSuggestions(request);
  };

  const completionNamed = (name) => getCompletions().find((completion) => completion.name === name);

  beforeEach(async () => {
    jasmine.useRealClock();
    await lumine.packages.activatePackage("autocomplete-lumine");
    provider = lumine.packages
      .getActivePackage("autocomplete-lumine")
      .mainModule.provideAutocomplete();
    await conditionPromise(() => Object.keys(provider.completions).length > 0, "completions");
    await lumine.workspace.open("test.js");
    editor = lumine.workspace.getActiveTextEditor();
  });

  it("only includes completions in files that are in a Lumine package or Lumine core", () => {
    const emptyProjectPath = temp.mkdirSync("lumine-project-");
    lumine.project.setPaths([emptyProjectPath]);

    return lumine.workspace.open("empty.js").then(() => {
      expect(provider.isInLuminePackage(emptyProjectPath)).toBe(false);
      editor = lumine.workspace.getActiveTextEditor();
      editor.setText("lumine.");
      editor.setCursorBufferPosition([0, Infinity]);

      expect(getCompletions()).toBeUndefined();
    });
  });

  it("includes completions in .lumine/init", () => {
    const emptyProjectPath = temp.mkdirSync("some-guy");
    lumine.project.setPaths([emptyProjectPath]);

    return lumine.workspace.open(".lumine/init.js").then(() => {
      expect(provider.isInLuminePackage(emptyProjectPath)).toBe(false);
      editor = lumine.workspace.getActiveTextEditor();
      editor.setText("lumine.");
      editor.setCursorBufferPosition([0, Infinity]);

      expect(getCompletions()).not.toBeUndefined();
    });
  });

  it("does not fail when no editor path", () => {
    const emptyProjectPath = temp.mkdirSync("some-guy");
    lumine.project.setPaths([emptyProjectPath]);

    return lumine.workspace.open().then(() => {
      editor = lumine.workspace.getActiveTextEditor();
      editor.setText("lumine.");
      editor.setCursorBufferPosition([0, Infinity]);
      expect(getCompletions()).toBeUndefined();
    });
  });

  it("ranks in the domain-expert tier, above the general-purpose providers", () => {
    // Autocomplete concatenates each provider's suggestions in provider order
    // and never re-sorts across providers, so priority alone decides position.
    // The general-purpose tier is 2; see "Ranking" in autocomplete's
    // `docs/autocomplete.provider.md` for the ladder these come from.
    expect(provider.suggestionPriority).toBeGreaterThan(2);
    // Below this a provider using `excludeLowerPriority` drops this one.
    expect(provider.inclusionPriority).toBeGreaterThan(0);
  });

  it("includes completions in a package that is not itself a project root", () => {
    // The flat workspace: the root holds one repository per directory and
    // carries no manifest of its own, so the package a file belongs to is
    // found by walking up from that file, not by inspecting the project roots.
    const workspacePath = temp.mkdirSync("lumine-workspace-");
    const packagePath = path.join(workspacePath, "some-package");
    fs.mkdirSync(path.join(packagePath, "lib"), { recursive: true });
    fs.writeFileSync(
      path.join(packagePath, "package.json"),
      JSON.stringify({ name: "some-package", engines: { lumine: "^1.0.0" } }),
    );
    lumine.project.setPaths([workspacePath]);

    return lumine.workspace.open(path.join(packagePath, "lib", "main.js")).then(() => {
      expect(provider.isInLuminePackage(workspacePath)).toBe(false);
      editor = lumine.workspace.getActiveTextEditor();
      editor.setText("lumine.");
      editor.setCursorBufferPosition([0, Infinity]);

      expect(getCompletions().some(({ text }) => text === "workspace")).toBe(true);
    });
  });

  it("includes properties and functions on the lumine global", () => {
    editor.setText("lumine.");
    editor.setCursorBufferPosition([0, Infinity]);

    // Instance properties are sorted ahead of methods.
    expect(getCompletions().some(({ text }) => text === "application")).toBe(true);
    expect(getCompletions().some(({ text }) => text === "window")).toBe(true);
    expect(getCompletions().some(({ text }) => text === "clipboard")).toBe(true);

    editor.setText("var c = lumine.");
    editor.setCursorBufferPosition([0, Infinity]);
    expect(getCompletions().some(({ text }) => text === "clipboard")).toBe(true);

    editor.setText("lumine.c");
    editor.setCursorBufferPosition([0, Infinity]);

    const clipboard = completionNamed("clipboard");
    expect(clipboard.type).toBe("property");
    expect(clipboard.leftLabel).toBe("Clipboard");
    expect(completionNamed("commands").type).toBe("property");
    expect(completionNamed("config").type).toBe("property");

    expect(completionNamed("confirm")).toBeUndefined();
  });

  it("includes methods on lumine global properties", () => {
    editor.setText("lumine.clipboard.");
    editor.setCursorBufferPosition([0, Infinity]);

    expect(getCompletions().length).toBeGreaterThan(0);
    expect(completionNamed("read").text).toBe("read()");
    expect(completionNamed("write").snippet).toBe("write(${1:text}, ${2:metadata})");

    editor.setText("lumine.window.");
    editor.setCursorBufferPosition([0, Infinity]);
    expect(completionNamed("getId").text).toBe("getId()");
    expect(completionNamed("broadcast").snippet).toMatch(/^broadcast\(/);
    expect(completionNamed("confirm").snippet).toMatch(/^confirm\(/);

    editor.setText("lumine.application.");
    editor.setCursorBufferPosition([0, Infinity]);
    expect(completionNamed("getPath").snippet).toBe("getPath(${1:name})");
    expect(completionNamed("getVersion").text).toBe("getVersion()");
    expect(completionNamed("openWindow").snippet).toMatch(/^openWindow\(/);
    expect(completionNamed("restart").text).toBe("restart()");

    editor.setText("lumine.shell.");
    editor.setCursorBufferPosition([0, Infinity]);
    expect(completionNamed("openExternal").snippet).toMatch(/^openExternal\(/);

    editor.setText("lumine.runtime.");
    editor.setCursorBufferPosition([0, Infinity]);
    expect(completionNamed("whenShellEnvironmentLoaded").text).toBe("whenShellEnvironmentLoaded()");
  });
});

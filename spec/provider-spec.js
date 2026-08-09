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
    await atom.packages.activatePackage("autocomplete-lumine");
    provider = atom.packages
      .getActivePackage("autocomplete-lumine")
      .mainModule.provideAutocomplete();
    await conditionPromise(() => Object.keys(provider.completions).length > 0, "completions");
    await conditionPromise(() => provider.packageDirectories?.length > 0, "package directories");
    await atom.workspace.open("test.js");
    editor = atom.workspace.getActiveTextEditor();
  });

  it("only includes completions in files that are in a Lumine package or Lumine core", () => {
    const emptyProjectPath = temp.mkdirSync("atom-project-");
    atom.project.setPaths([emptyProjectPath]);

    return atom.workspace.open("empty.js").then(() => {
      expect(provider.packageDirectories.length).toBe(0);
      editor = atom.workspace.getActiveTextEditor();
      editor.setText("atom.");
      editor.setCursorBufferPosition([0, Infinity]);

      expect(getCompletions()).toBeUndefined();
    });
  });

  it("only includes completions in .atom/init", () => {
    const emptyProjectPath = temp.mkdirSync("some-guy");
    atom.project.setPaths([emptyProjectPath]);

    return atom.workspace.open(".atom/init.js").then(() => {
      expect(provider.packageDirectories.length).toBe(0);
      editor = atom.workspace.getActiveTextEditor();
      editor.setText("atom.");
      editor.setCursorBufferPosition([0, Infinity]);

      expect(getCompletions()).not.toBeUndefined();
    });
  });

  it("does not fail when no editor path", () => {
    const emptyProjectPath = temp.mkdirSync("some-guy");
    atom.project.setPaths([emptyProjectPath]);

    return atom.workspace.open().then(() => {
      expect(provider.packageDirectories.length).toBe(0);
      editor = atom.workspace.getActiveTextEditor();
      editor.setText("atom.");
      editor.setCursorBufferPosition([0, Infinity]);
      expect(getCompletions()).toBeUndefined();
    });
  });

  it("includes properties and functions on the atom global", () => {
    editor.setText("atom.");
    editor.setCursorBufferPosition([0, Infinity]);

    // Instance properties are sorted ahead of methods.
    expect(getCompletions().some(({ text }) => text === "app")).toBe(true);
    expect(getCompletions().some(({ text }) => text === "window")).toBe(true);
    expect(getCompletions().some(({ text }) => text === "clipboard")).toBe(true);

    editor.setText("var c = atom.");
    editor.setCursorBufferPosition([0, Infinity]);
    expect(getCompletions().some(({ text }) => text === "clipboard")).toBe(true);

    editor.setText("atom.c");
    editor.setCursorBufferPosition([0, Infinity]);

    const clipboard = completionNamed("clipboard");
    expect(clipboard.type).toBe("property");
    expect(clipboard.leftLabel).toBe("Clipboard");
    expect(completionNamed("commands").type).toBe("property");
    expect(completionNamed("config").type).toBe("property");

    expect(completionNamed("confirm")).toBeUndefined();
  });

  it("includes methods on atom global properties", () => {
    editor.setText("atom.clipboard.");
    editor.setCursorBufferPosition([0, Infinity]);

    expect(getCompletions().length).toBeGreaterThan(0);
    expect(completionNamed("read").text).toBe("read()");
    expect(completionNamed("write").snippet).toBe("write(${1:text}, ${2:metadata})");

    editor.setText("atom.window.");
    editor.setCursorBufferPosition([0, Infinity]);
    expect(completionNamed("getId").text).toBe("getId()");
    expect(completionNamed("broadcast").snippet).toMatch(/^broadcast\(/);
    expect(completionNamed("confirm").snippet).toMatch(/^confirm\(/);

    editor.setText("atom.app.");
    editor.setCursorBufferPosition([0, Infinity]);
    expect(completionNamed("getPath").snippet).toBe("getPath(${1:name})");
    expect(completionNamed("getVersion").text).toBe("getVersion()");
    expect(completionNamed("openWindow").snippet).toMatch(/^openWindow\(/);
    expect(completionNamed("restart").text).toBe("restart()");

    editor.setText("atom.shell.");
    editor.setCursorBufferPosition([0, Infinity]);
    expect(completionNamed("openExternal").snippet).toMatch(/^openExternal\(/);

    editor.setText("atom.runtime.");
    editor.setCursorBufferPosition([0, Infinity]);
    expect(completionNamed("whenShellEnvironmentLoaded").text).toBe("whenShellEnvironmentLoaded()");
  });
});

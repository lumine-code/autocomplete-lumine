const fs = require("fs");
const path = require("path");

const temp = require("@lumine-code/fs-temp");
const completions = require("../completions.json");

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

  describe("manifest changes", () => {
    let packagePath, manifestPath;
    const metadata = { name: "new-package", engines: { lumine: "^1.0.0" } };

    const writeManifest = (value) => fs.writeFileSync(manifestPath, JSON.stringify(value));
    const changeManifest = async (change) => {
      let changed = false;
      const subscription = lumine.project.onDidChangeFiles((events) => {
        if (events.some((event) => event.path === manifestPath)) changed = true;
      });
      try {
        change();
        await conditionPromise(() => changed, "manifest filesystem event");
      } finally {
        subscription.dispose();
      }
    };

    beforeEach(async () => {
      packagePath = temp.mkdirSync("lumine-manifest-");
      manifestPath = path.join(packagePath, "package.json");
      fs.mkdirSync(path.join(packagePath, "lib"));
      lumine.project.setPaths([packagePath]);
      await lumine.project.getWatcherPromise(packagePath);
      editor = await lumine.workspace.open(path.join(packagePath, "lib", "main.js"));
      editor.setText("lumine.");
      editor.setCursorBufferPosition([0, Infinity]);
    });

    it("enables completions after a missing manifest is created", async () => {
      expect(getCompletions()).toBeUndefined();
      await changeManifest(() => writeManifest(metadata));
      expect(getCompletions().some(({ text }) => text === "workspace")).toBe(true);
    });

    it("updates both classifications when engines change", async () => {
      await changeManifest(() => writeManifest(metadata));
      expect(getCompletions()).not.toBeUndefined();
      await changeManifest(() => writeManifest({ name: "new-package", engines: { node: ">=24" } }));
      expect(getCompletions()).toBeUndefined();
      await changeManifest(() => writeManifest(metadata));
      expect(getCompletions()).not.toBeUndefined();
    });

    it("disables completions after the manifest is deleted", async () => {
      await changeManifest(() => writeManifest(metadata));
      expect(getCompletions()).not.toBeUndefined();
      await changeManifest(() => fs.unlinkSync(manifestPath));
      expect(getCompletions()).toBeUndefined();
    });

    it("rereads a malformed manifest after it is repaired", async () => {
      await changeManifest(() => fs.writeFileSync(manifestPath, "{"));
      expect(getCompletions()).toBeUndefined();
      await changeManifest(() => writeManifest(metadata));
      expect(getCompletions()).not.toBeUndefined();
    });

    it("refreshes Lumine core classification when its name changes", async () => {
      await changeManifest(() => writeManifest({ name: "lumine" }));
      expect(getCompletions()).not.toBeUndefined();
      await changeManifest(() => writeManifest({ name: "unrelated" }));
      expect(getCompletions()).toBeUndefined();
    });

    it("expires cached classification for files outside project roots", () => {
      lumine.project.setPaths([]);
      const clock = spyOn(Date, "now").and.returnValue(100);
      expect(getCompletions()).toBeUndefined();
      writeManifest(metadata);
      expect(getCompletions()).toBeUndefined();
      clock.and.returnValue(1100);
      expect(getCompletions()).not.toBeUndefined();
      fs.unlinkSync(manifestPath);
      clock.and.returnValue(2100);
      expect(getCompletions()).toBeUndefined();
    });

    it("refreshes classification after project roots change", () => {
      spyOn(Date, "now").and.returnValue(100);
      expect(getCompletions()).toBeUndefined();
      writeManifest(metadata);
      lumine.project.setPaths([]);
      expect(getCompletions()).not.toBeUndefined();
    });

    it("rereads manifests after filesystem observation is invalidated", () => {
      spyOn(Date, "now").and.returnValue(100);
      expect(getCompletions()).toBeUndefined();
      writeManifest(metadata);
      lumine.project.emitter.emit("did-invalidate-files", {
        rootPaths: [packagePath],
        reason: "watcher-reconnected",
        generation: 2,
      });
      expect(getCompletions()).not.toBeUndefined();
    });

    it("reuses the cache and skips filesystem work for unrelated prefixes", () => {
      writeManifest(metadata);
      const clock = spyOn(Date, "now").and.returnValue(100);
      const read = spyOn(provider, "readMetadata").and.callThrough();
      expect(getCompletions()).not.toBeUndefined();
      const reads = read.calls.count();
      expect(reads).toBeGreaterThan(0);
      getCompletions();
      expect(read.calls.count()).toBe(reads);
      clock.and.returnValue(2100);
      editor.setText("unrelated.");
      editor.setCursorBufferPosition([0, Infinity]);
      expect(getCompletions()).toEqual([]);
      expect(read.calls.count()).toBe(reads);
    });

    it("releases subscriptions and cached paths when the package unloads", async () => {
      expect(getCompletions()).toBeUndefined();
      const previousProvider = provider;
      const events = ["did-change-files", "did-change-paths", "did-invalidate-files"];
      const listenerCounts = events.map((event) =>
        lumine.project.emitter.listenerCountForEventName(event),
      );
      await lumine.packages.deactivatePackage("autocomplete-lumine");
      expect(previousProvider.packageDirectoryCache.size).toBe(0);
      events.forEach((event, index) => {
        expect(lumine.project.emitter.listenerCountForEventName(event)).toBe(
          listenerCounts[index] - 1,
        );
      });
      writeManifest(metadata);
      await lumine.packages.activatePackage("autocomplete-lumine");
      provider = lumine.packages
        .getActivePackage("autocomplete-lumine")
        .mainModule.provideAutocomplete();
      expect(getCompletions()).not.toBeUndefined();
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

  it("includes dialog host factories and inherited host methods", () => {
    const workspaceNames = completions.Workspace.map(({ name }) => name);
    expect(workspaceNames).toContain("addInputDialog");
    expect(workspaceNames).toContain("addSelectList");

    const selectListHostNames = completions.SelectListHost.map(({ name }) => name);
    expect(selectListHostNames).toContain("getModel");
    expect(selectListHostNames).toContain("show");
    expect(selectListHostNames).toContain("showActions");
    expect(selectListHostNames).toContain("destroy");
  });

  it("includes public object methods and the callable names of tool functions", () => {
    editor.setText("lumine.tools.");
    editor.setCursorBufferPosition([0, Infinity]);
    expect(completionNamed("fuzzyMatcher").type).toBe("property");
    expect(completionNamed("markdown").type).toBe("property");
    expect(completionNamed("removeDiacritics").snippet).toMatch(/^removeDiacritics\(/);

    editor.setText("lumine.tools.fuzzyMatcher.");
    editor.setCursorBufferPosition([0, Infinity]);
    expect(completionNamed("setCandidates").snippet).toMatch(/^setCandidates\(/);
    expect(completionNamed("score").snippet).toMatch(/^score\(/);
    expect(completionNamed("match").snippet).toMatch(/^match\(/);

    editor.setText("lumine.tools.markdown.");
    editor.setCursorBufferPosition([0, Infinity]);
    expect(completionNamed("render").snippet).toMatch(/^render\(/);
    expect(completionNamed("renderMarkdown")).toBeUndefined();
    expect(completionNamed("applySyntaxHighlighting").snippet).toMatch(
      /^applySyntaxHighlighting\(/,
    );
  });
});

const path = require("node:path");
const { execFileSync } = require("node:child_process");

function deferred() {
  let resolve;
  const promise = new Promise((accept) => (resolve = accept));
  return { promise, resolve };
}

describe("Native Lumine API completion data", () => {
  let provider, editor;
  beforeEach(async () => {
    if (lumine.packages.isPackageLoaded("autocomplete-lumine"))
      await lumine.packages.unloadPackage("autocomplete-lumine");
    provider = (
      await lumine.packages.activatePackage("autocomplete-lumine")
    ).mainModule.provideAutocomplete();
    editor = await lumine.workspace.open(path.join(lumine.getConfigDirPath(), "init.js"));
    editor.setText("lumine.workspace.");
    editor.setCursorBufferPosition([0, Infinity]);
  });
  afterEach(async () => {
    await lumine.packages.deactivatePackage("autocomplete-lumine");
    editor.destroy();
  });
  const request = (editor, signal) => ({
    editor,
    bufferPosition: editor.getCursorBufferPosition(),
    signal,
  });

  it("does not parse the large completion JSON during bootstrap", () => {
    const source = `
      const Module = require("node:module");
      const original = Module._load;
      Module._load = function(request, ...args) { return request === "lumine" ? {} : original.call(this, request, ...args); };
      const provider = require("./lib/main").provideAutocomplete();
      if (typeof provider.getSuggestions !== "function") throw new Error("Missing provider");
      console.log(JSON.stringify(Object.keys(require.cache).filter(file => file.endsWith("completions.json"))));
    `;
    const output = execFileSync(process.execPath, ["-e", source], {
      cwd: path.resolve(__dirname, ".."),
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      windowsHide: true,
      encoding: "utf8",
    });
    expect(JSON.parse(output.trim())).toEqual([]);
    expect(provider.completionReady).toBe(false);
  });

  it("shares attributed native JSON imports and the existing CommonJS data identity", async () => {
    const Loader = require("../lib/completion-loader");
    const loader = new Loader();
    const imported = spyOn(loader, "importClasses").and.callThrough();
    const first = loader.load();
    expect(loader.load()).toBe(first);
    expect(await first).toBe(require("../completions.json"));
    expect(imported).toHaveBeenCalledTimes(1);
  });

  it("shares the first useful queries and returns synchronous arrays when ready", async () => {
    const imported = spyOn(provider, "loadClasses").and.callThrough();
    const [first, second] = await Promise.all([
      provider.getSuggestions(request(editor)),
      provider.getSuggestions(request(editor)),
    ]);
    expect(first.some((item) => item.name === "open")).toBe(true);
    expect(second).toEqual(first);
    expect(imported).toHaveBeenCalledTimes(1);
    expect(Array.isArray(provider.getSuggestions(request(editor)))).toBe(true);
    expect(Array.isArray(provider.getCompletions("lumine.workspace."))).toBe(true);
  });

  it("does not import for short unrelated, cancelled, or disabled requests", async () => {
    const imported = spyOn(provider, "loadClasses").and.callThrough();
    editor.setText("lum");
    editor.setCursorBufferPosition([0, Infinity]);
    expect(provider.getSuggestions(request(editor))).toEqual([]);
    editor.setText("lumine.workspace.");
    editor.setCursorBufferPosition([0, Infinity]);
    const controller = new AbortController();
    controller.abort();
    expect(provider.getSuggestions(request(editor, controller.signal))).toEqual([]);
    await lumine.packages.deactivatePackage("autocomplete-lumine");
    expect(provider.getSuggestions(request(editor))).toEqual([]);
    expect(imported).not.toHaveBeenCalled();
  });

  for (const retire of ["signal", "document", "package"]) {
    it(`does not return suggestions after its ${retire} retires during import`, async () => {
      const classes = require("../completions.json");
      const importing = deferred();
      spyOn(provider, "loadClasses").and.returnValue(importing.promise);
      const controller = new AbortController();
      const pending = provider.getSuggestions(request(editor, controller.signal));
      if (retire === "signal") controller.abort();
      else if (retire === "document") editor.insertText("changed");
      else await lumine.packages.deactivatePackage("autocomplete-lumine");
      importing.resolve(classes);
      expect(await pending).toEqual([]);
    });
  }

  it("retries rejected data loading while keeping synchronous legacy completion access", async () => {
    const nativeLoad = provider.loadClasses.bind(provider);
    const failure = new Error("temporary completion data failure");
    const imported = spyOn(provider, "loadClasses").and.rejectWith(failure);
    await expectAsync(provider.getSuggestions(request(editor))).toBeRejectedWith(failure);
    imported.and.callFake(nativeLoad);
    expect(
      (await provider.getSuggestions(request(editor))).some((item) => item.name === "open"),
    ).toBe(true);
    expect(imported).toHaveBeenCalledTimes(2);
  });

  it("keeps completion data from a retired generation out of the reloaded provider", async () => {
    const oldProvider = provider;
    const classes = require("../completions.json");
    const importing = deferred();
    spyOn(provider, "loadClasses").and.returnValue(importing.promise);
    const pending = provider.getSuggestions(request(editor));
    await lumine.packages.unloadPackage("autocomplete-lumine");
    provider = (
      await lumine.packages.activatePackage("autocomplete-lumine")
    ).mainModule.provideAutocomplete();
    const current = await provider.getSuggestions(request(editor));
    importing.resolve(classes);
    expect(await pending).toEqual([]);
    expect(provider).not.toBe(oldProvider);
    expect(current.some((item) => item.name === "open")).toBe(true);
    expect(await provider.loadClasses()).toBe(require("../completions.json"));
    expect(await provider.loadClasses()).not.toBe(classes);
  });
});

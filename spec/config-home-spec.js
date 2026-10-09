const path = require("node:path");
const fs = require("fs");
const os = require("node:os");

describe("Lumine API completions in the configured home", () => {
  it("suggests the API in the real custom-home init.js editor without a package manifest", async () => {
    const main = (await lumine.packages.activatePackage("autocomplete-lumine")).mainModule;
    const provider = main.provideAutocomplete();
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "api-init-home-control-"));
    spyOn(lumine, "getConfigDirPath").and.returnValue(home);
    expect(path.basename(home)).not.toBe(".lumine");
    const editor = await lumine.workspace.open(path.join(home, "init.js"));
    try {
      editor.setText("lumine.workspace.");
      editor.setCursorBufferPosition([0, Infinity]);

      const suggestions = provider.getSuggestions({
        editor,
        bufferPosition: editor.getCursorBufferPosition(),
      });

      expect(Array.isArray(suggestions)).toBe(true);
      expect(suggestions?.some((item) => item.name === "open")).toBe(true);
    } finally {
      editor.destroy();
      await lumine.fileWatchClient.settlePendingTeardown();
      fs.rmdirSync(home);
    }
  });
});

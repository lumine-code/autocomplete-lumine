// Authentic package usage. Run with lumine/script/demo.js; fixtures stay in demo/.
module.exports = {
  version: 1,
  dependencies: ["language-javascript", "autocomplete"],
  viewport: { width: 1100, height: 520 },
  async before() {},
  async prepare(context) {
    const { lumine, state, fixture, open } = context;
    state.editor = await open("api-completions/main.js");
    await lumine.project.setPaths([fixture("api-completions")]);
  },
  scenes: [
    {
      id: "scene-1",
      file: "demo.png",
      caption: "Complete Lumine workspace API methods while authoring a package.",
      timeout: 60000,
      async run(context) {
        const { lumine, state } = context;
        {
          await lumine.window.focus();
          state.editor.setCursorBufferPosition([2, 24]);
          state.editor.moveToEndOfLine();
          lumine.views.getView(state.editor).blur();
          lumine.views.getView(state.editor).focus();
          await new Promise((r) => setTimeout(r, 350));
          lumine.commands.dispatch(lumine.views.getView(state.editor), "autocomplete:activate");
        }
      },
      ready() {
        return Boolean(
          document
            .querySelector(".autocomplete-suggestion-list")
            ?.innerText.includes("getTextEditors"),
        );
      },
    },
  ],
  async cleanup() {},
};

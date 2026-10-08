const provider = require("./provider");

module.exports = {
  activate() {
    return provider.load();
  },

  deactivate() {
    provider.unload();
  },

  provideAutocomplete() {
    return provider;
  },
};

module.exports = class CompletionLoader {
  importClasses() {
    return import("../completions.json", { with: { type: "json" } });
  }

  load() {
    this.pending ??= Promise.resolve()
      .then(() => this.importClasses())
      .then((namespace) => namespace.default)
      .catch((error) => {
        this.pending = null;
        throw error;
      });
    return this.pending;
  }
};

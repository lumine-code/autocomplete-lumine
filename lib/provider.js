const fs = require("fs");
const path = require("path");
const { CompositeDisposable } = require("lumine");

const CLASSES = require("../completions.json");
const packageDirectoryCacheDuration = 1000;

const propertyPrefixPattern =
  /(?:^|\[|\(|,|=|:|\s)\s*(lumine\.(?:[a-zA-Z_$][\w$]*\.)*(?:[a-zA-Z_$][\w$]*)?)$/;

module.exports = {
  scopeSelector: ".source.coffee, .source.js",
  filterSuggestions: true,

  // Domain-expert tier: the one thing this answers is a `lumine.` member
  // access inside a Lumine package, and there it is the authoritative source.
  // It returns nothing anywhere else, so it costs the tiers below it nothing.
  // See "Ranking" in autocomplete's `docs/autocomplete.provider.md`; left
  // unset, the default of 1 puts these under every general-purpose provider.
  suggestionPriority: 4,
  inclusionPriority: 2,

  // The prefix is matched before the file is placed, so the only filesystem
  // work this provider does is skipped on every keystroke that is not a
  // `lumine.` member access — which is all but a handful of them.
  getSuggestions({ bufferPosition, editor }) {
    const line = editor.getTextInRange([[bufferPosition.row, 0], bufferPosition]);
    const match = propertyPrefixPattern.exec(line)?.[1];
    if (!match) {
      return [];
    }
    if (!this.isEditingALuminePackageFile(editor)) {
      return;
    }
    return this.getCompletions(match);
  },

  load() {
    this.unload();
    this.packageDirectoryCache = new Map();
    this.subscriptions = new CompositeDisposable(
      lumine.project.onDidChangeFiles((events) => {
        if (events.some((event) => path.basename(event.path) === "package.json")) {
          this.clearPackageDirectoryCache();
        }
      }),
      lumine.project.onDidChangePaths(() => this.clearPackageDirectoryCache()),
      lumine.project.onDidInvalidateFiles(() => this.clearPackageDirectoryCache()),
    );
    return this.loadCompletions();
  },

  unload() {
    this.subscriptions?.dispose();
    this.subscriptions = null;
    this.clearPackageDirectoryCache();
  },

  clearPackageDirectoryCache() {
    this.packageDirectoryCache?.clear();
    this.packageDirectoryCacheExpiresAt = 0;
  },

  readMetadata(directory) {
    try {
      return JSON.parse(fs.readFileSync(path.join(directory, "package.json")));
    } catch {
      // No manifest here, or one that does not parse. Either way this
      // directory does not answer the question, and its parent still might.
      return null;
    }
  },

  isLuminePackage(metadata) {
    return metadata?.engines?.lumine?.length > 0;
  },

  isLumineCore(metadata) {
    return metadata?.name === "lumine";
  },

  isEditingALuminePackageFile(editor) {
    const editorPath = editor.getPath();
    if (editorPath == null) {
      return false;
    }
    const parsedPath = path.parse(editorPath);
    const basename = path.basename(parsedPath.dir);
    if (basename === ".lumine") {
      if (parsedPath.base === "init.js") {
        return true;
      }
    }
    return this.isInLuminePackage(parsedPath.dir);
  },

  // Answered from the file's own path rather than from the project roots: a
  // root is not necessarily a package. This workspace is flat, so its root
  // holds one repository per directory and carries no manifest of its own, and
  // a scan one level deep would place none of its files. Every directory on
  // the way up is memoized against the answer the walk settled on, so a second
  // lookup anywhere under the same tree reuses it. Project manifest events
  // invalidate the cache immediately. Its short lifetime also covers files
  // outside project roots and filesystem observation gaps, without reading a
  // manifest on every completion request or owning more native watchers.
  isInLuminePackage(directory) {
    if (this.packageDirectoryCache == null) {
      this.packageDirectoryCache = new Map();
    }
    const now = Date.now();
    if (now >= (this.packageDirectoryCacheExpiresAt ?? 0)) {
      this.clearPackageDirectoryCache();
      this.packageDirectoryCacheExpiresAt = now + packageDirectoryCacheDuration;
    }
    const visited = [];
    let current = directory;
    let result = false;

    while (current) {
      const cached = this.packageDirectoryCache.get(current);
      if (cached !== undefined) {
        result = cached;
        break;
      }
      visited.push(current);
      const metadata = this.readMetadata(current);
      if (this.isLuminePackage(metadata) || this.isLumineCore(metadata)) {
        result = true;
        break;
      }
      const parent = path.dirname(current);
      current = parent === current ? null : parent;
    }

    for (const entry of visited) {
      this.packageDirectoryCache.set(entry, result);
    }
    return result;
  },

  loadCompletions() {
    if (this.completions == null) {
      this.completions = {};
    }
    this.loadProperty("lumine", "Environment", CLASSES);
    for (const [accessPath, completions] of Object.entries(CLASSES)) {
      if (accessPath.startsWith("lumine.")) this.completions[accessPath] = { completions };
    }
  },

  getCompletions(match) {
    const completions = [];
    let segments = match.split(".");
    const prefix = segments.pop() ?? "";
    segments = segments.filter((segment) => segment);
    const property = segments.join(".");
    const propertyCompletions =
      this.completions[property]?.completions != null
        ? this.completions[property]?.completions
        : [];
    for (let completion of propertyCompletions) {
      if (!prefix || firstCharsEqual(completion.name, prefix)) {
        completions.push(clone(completion));
      }
    }
    return completions;
  },

  getPropertyClass(accessPath) {
    const value = accessPath
      .split(".")
      .slice(1)
      .reduce((current, name) => current?.[name], lumine);
    return value?.constructor?.name;
  },

  loadProperty(propertyName, className, classes) {
    const classCompletions = classes[className];
    if (classCompletions == null) {
      return;
    }

    this.completions[propertyName] = { completions: [] };

    for (let completion of classCompletions) {
      this.completions[propertyName].completions.push(completion);
      if (completion.type === "property") {
        const accessPath = `${propertyName}.${completion.name}`;
        const propertyClass = this.getPropertyClass(accessPath);
        this.loadProperty(accessPath, propertyClass, classes);
      }
    }
  },
};

const clone = function (obj) {
  const newObj = {};
  for (let k in obj) {
    const v = obj[k];
    newObj[k] = v;
  }
  return newObj;
};

const firstCharsEqual = (str1, str2) => str1[0].toLowerCase() === str2[0].toLowerCase();

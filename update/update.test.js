"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { completionsFromApi } = require("./update");

function member(name, kind = "method", overrides = {}) {
  return {
    name,
    kind,
    static: false,
    summary: `The ${name} API.`,
    propertyType: null,
    returnType: null,
    returnDescription: "",
    parameters: [],
    ...overrides,
  };
}

function parameter(name, overrides = {}) {
  return { name, source: name, optional: false, rest: false, ...overrides };
}

function emptyApi(overrides = {}) {
  return { classes: [], objects: [], functions: [], ...overrides };
}

test("keeps inherited instance API slots and places properties before methods", () => {
  const api = emptyApi({
    classes: [
      {
        name: "Base",
        superClass: null,
        members: [
          member("shared", "method", { parameters: [parameter("oldValue")] }),
          member("ready", "get", { returnType: "Boolean" }),
        ],
      },
      {
        name: "Child",
        superClass: "Base",
        members: [
          member("constructor", "constructor"),
          member("create", "method", { static: true }),
          member("writeOnly", "set"),
          member("shared", "method", { parameters: [parameter("newValue")] }),
          member("version", "property", { propertyType: "String" }),
          member("alpha"),
        ],
      },
    ],
  });
  const child = completionsFromApi(api).Child;
  assert.deepEqual(
    child.map(({ name }) => name),
    ["ready", "version", "alpha", "shared"],
  );
  assert.equal(child[0].type, "property");
  assert.equal(child[0].text, "ready");
  assert.equal(child[0].leftLabel, "Boolean");
  assert.equal(child[1].leftLabel, "String");
  assert.equal(child[3].snippet, "shared(${1:newValue})");
});

test("preserves object properties and accessors instead of generating calls", () => {
  const api = emptyApi({
    objects: [
      {
        name: "Factory",
        accessPath: "lumine.tools.factory",
        summary: "Factories.",
        members: [
          member("execute", "method", { static: true }),
          member("writeOnly", "set", { static: true }),
          member("ready", "get", { static: true, returnType: "Boolean" }),
          member("version", "property", { static: true, propertyType: "String" }),
        ],
      },
    ],
  });
  const completions = completionsFromApi(api);
  for (const key of ["Factory", "lumine.tools.factory"]) {
    assert.deepEqual(
      completions[key].map(({ name }) => name),
      ["ready", "version", "execute"],
    );
    assert.equal(completions[key][0].text, "ready");
    assert.equal(completions[key][0].type, "property");
    assert.equal(completions[key][1].text, "version");
    assert.equal(completions[key][1].type, "property");
    assert.equal(completions[key][2].text, "execute()");
  }
  assert.equal(completions.Environment[0].name, "tools");
  assert.equal(completions["lumine.tools"][0].name, "factory");
  assert.equal(completions["lumine.tools"][0].leftLabel, "Factory");
});

test("uses callable function names and excludes nested option fields from snippets", () => {
  const api = emptyApi({
    classes: [
      {
        name: "Environment",
        members: [member("tools", "property", { propertyType: "Object" })],
      },
    ],
    objects: [
      {
        name: "Factory",
        accessPath: "lumine.tools.factory",
        summary: "Factories.",
        members: [
          member("collect", "method", {
            parameters: [
              parameter("values", { rest: true }),
              parameter("values.label", { nested: true }),
            ],
          }),
        ],
      },
    ],
    functions: [
      {
        name: "render",
        accessPath: "lumine.tools.markdown.render",
        summary: "Render Markdown.",
        returnType: "String",
        parameters: [
          parameter("content"),
          parameter("options", { optional: true }),
          parameter("options.html", { nested: true }),
        ],
      },
    ],
  });
  const completions = completionsFromApi(api);
  assert.equal(completions.Environment.length, 1);
  assert.equal(completions["lumine.tools.markdown"][0].name, "render");
  assert.equal(
    completions["lumine.tools.markdown"][0].snippet,
    "render(${1:content}, ${2:options})",
  );
  assert.equal(completions["lumine.tools.factory"][0].snippet, "collect(${1:...values})");
  assert.ok(
    Object.values(completions)
      .flat()
      .every(({ name }) => name !== "renderMarkdown"),
  );
});

test("keeps identically named namespaces at different full access paths separate", () => {
  const api = emptyApi({
    objects: [
      {
        name: "FirstFactory",
        accessPath: "lumine.tools.factory",
        summary: "First.",
        members: [member("first")],
      },
      {
        name: "SecondFactory",
        accessPath: "lumine.other.factory",
        summary: "Second.",
        members: [member("second")],
      },
    ],
  });
  const completions = completionsFromApi(api);
  assert.deepEqual(
    completions["lumine.tools.factory"].map(({ name }) => name),
    ["first"],
  );
  assert.deepEqual(
    completions["lumine.other.factory"].map(({ name }) => name),
    ["second"],
  );
  assert.equal(completions.factory, undefined);
});

test("does not offer require exports or functions without a global access path on lumine", () => {
  const api = emptyApi({
    objects: [
      {
        name: "Icon",
        accessPath: "require('lumine').Icon",
        summary: "Icons.",
        members: [member("none")],
      },
    ],
    functions: [
      {
        name: "watchFile",
        accessPath: "require('lumine').watchFile",
        parameters: [parameter("filePath")],
      },
      { name: "internalHelper", parameters: [] },
    ],
  });
  const completions = completionsFromApi(api);
  assert.equal(completions.Icon[0].text, "none()");
  assert.equal(completions.Environment, undefined);
  assert.ok(Object.keys(completions).every((key) => !key.startsWith("lumine.")));
});

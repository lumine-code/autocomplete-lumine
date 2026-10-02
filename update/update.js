"use strict";

/**
 * Regenerate the static completions used by autocomplete-lumine from the
 * editor-owned API schema.
 *
 * Run `npm run update -- --editor <path>` or set LUMINE_CORE_ROOT. Pass
 * `--check` to compare generated output without writing it.
 */

const fs = require("fs");
const path = require("path");
const parser = require("@babel/parser");

function optionValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a path.`);
  return value;
}

function compareNames(left, right) {
  return left.name.localeCompare(right.name);
}

function plainDocumentationText(value) {
  return value
    ?.replace(
      /\{@link\s+([^}\s|]+)(?:\s*\|\s*|\s+)?([^}]*)\}/g,
      (_match, target, label) => label.trim() || target.replace("#", "."),
    )
    .replace(/`([^`]+)`/g, "$1");
}

function propertySuggestion(member) {
  return {
    name: member.name,
    text: member.name,
    description: plainDocumentationText(
      member.summary ||
        member.returnDescription ||
        member.propertyType ||
        "Documented API property.",
    ),
    leftLabel:
      member.propertyType || member.returnType || member.summary?.match(/\{([^}]+)\}/)?.[1],
    type: "property",
  };
}

function methodSuggestion(member) {
  const parameterNames = member.parameters
    .filter(({ name, nested }) => name && !nested && !name.includes("."))
    .map(({ name, rest }) => (rest ? `...${name}` : name));
  const suggestion = {
    name: member.name,
    text: null,
    snippet: null,
    description: plainDocumentationText(
      member.summary ||
        member.returnDescription ||
        (member.returnType ? `Returns ${member.returnType}.` : "Documented API method."),
    ),
    leftLabel: member.returnType,
    type: "method",
  };
  if (parameterNames.length) {
    const placeholders = parameterNames.map((name, index) => `\${${index + 1}:${name}}`);
    suggestion.snippet = `${member.name}(${placeholders.join(", ")})`;
  } else {
    suggestion.text = `${member.name}()`;
  }
  return suggestion;
}

function memberSuggestion(member) {
  if (["property", "get"].includes(member.kind)) return propertySuggestion(member);
  if (member.kind === "method") return methodSuggestion(member);
  return null;
}

function instanceMembersFor(cls, classesByName, visiting = new Set()) {
  if (visiting.has(cls.name)) return [];
  const nextVisiting = new Set(visiting).add(cls.name);
  const inherited = cls.superClass ? classesByName.get(cls.superClass) : null;
  const members = inherited ? instanceMembersFor(inherited, classesByName, nextVisiting) : [];
  const byApiSlot = new Map(
    members.map((member) => [
      `${["property", "get", "set"].includes(member.kind) ? "property" : member.kind}:${member.name}`,
      member,
    ]),
  );
  for (const member of cls.members.filter(
    (candidate) => !candidate.static && candidate.kind !== "constructor",
  )) {
    const slot = `${["property", "get", "set"].includes(member.kind) ? "property" : member.kind}:${member.name}`;
    byApiSlot.set(slot, member);
  }
  return [...byApiSlot.values()];
}

function completionsFromApi(api) {
  const completions = {};
  const classesByName = new Map(api.classes.map((cls) => [cls.name, cls]));
  for (const cls of api.classes) {
    const instanceMembers = instanceMembersFor(cls, classesByName);
    const suggestions = instanceMembers.map(memberSuggestion).filter(Boolean);
    if (suggestions.length) completions[cls.name] = suggestions;
  }

  const addSuggestion = (accessPath, suggestion) => {
    if (!accessPath.startsWith("lumine.")) return;
    const segments = accessPath.split(".");
    for (let index = 1; index < segments.length; index++) {
      const parent = segments.slice(0, index).join(".");
      const key = parent === "lumine" ? "Environment" : parent;
      const suggestions = (completions[key] ||= []);
      const name = segments[index];
      const existing = suggestions.findIndex((entry) => entry.name === name);
      const entry =
        index === segments.length - 1
          ? suggestion
          : {
              name,
              text: name,
              description: "Documented API namespace.",
              type: "property",
            };
      if (existing < 0) suggestions.push(entry);
      else if (index === segments.length - 1) suggestions[existing] = entry;
    }
  };

  for (const object of api.objects || []) {
    completions[object.name] = object.members.map(memberSuggestion).filter(Boolean);
    if (!object.accessPath?.startsWith("lumine.")) continue;
    const name = object.accessPath.split(".").at(-1);
    addSuggestion(object.accessPath, {
      name,
      text: name,
      description: plainDocumentationText(object.summary),
      leftLabel: object.name,
      type: "property",
    });
    for (const member of object.members) {
      const suggestion = memberSuggestion(member);
      if (suggestion) addSuggestion(`${object.accessPath}.${member.name}`, suggestion);
    }
  }
  for (const fn of api.functions) {
    if (fn.accessPath?.startsWith("lumine.")) {
      addSuggestion(fn.accessPath, methodSuggestion(fn));
    }
  }
  for (const suggestions of Object.values(completions)) {
    suggestions.sort(
      (left, right) =>
        Number(left.type !== "property") - Number(right.type !== "property") ||
        compareNames(left, right),
    );
  }
  return completions;
}

function update() {
  const editorOption = optionValue("--editor") || process.env.LUMINE_CORE_ROOT;
  if (!editorOption) {
    throw new Error("Pass --editor <path> or set LUMINE_CORE_ROOT to a Lumine editor checkout.");
  }
  const editorRoot = path.resolve(editorOption);
  const outputPath = path.join(__dirname, "..", "completions.json");
  const extractorPath = path.join(editorRoot, "script", "api-extractor.js");
  if (!fs.existsSync(extractorPath)) {
    throw new Error(`The editor checkout has no canonical API extractor: ${extractorPath}`);
  }
  const { SCHEMA_VERSION, extractApi } = require(extractorPath);
  const api = extractApi({ editorRoot, parser });
  if (api.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`Unsupported API schema ${api.schemaVersion}; expected ${SCHEMA_VERSION}.`);
  }
  const completions = completionsFromApi(api);
  const generated = `${JSON.stringify(completions, null, "  ")}\n`;
  const groupCount = Object.keys(completions).length;
  const itemCount = Object.values(completions).reduce((count, items) => count + items.length, 0);

  if (process.argv.includes("--check")) {
    const committed = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : null;
    if (committed !== generated) {
      throw new Error(
        `completions.json is out of date (${groupCount} API groups and ${itemCount} suggestions generated).`,
      );
    }
    console.log(
      `completions.json is current: ${groupCount} API groups and ${itemCount} suggestions`,
    );
    return;
  }

  fs.writeFileSync(outputPath, generated);
  console.log(`Updated ${groupCount} API groups and ${itemCount} suggestions in completions.json`);
}

if (require.main === module) {
  try {
    update();
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}

module.exports = { completionsFromApi };

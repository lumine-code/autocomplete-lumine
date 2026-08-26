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
    leftLabel: member.propertyType || member.summary?.match(/\{([^}]+)\}/)?.[1],
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

function completionsFromApi(api) {
  const completions = {};
  for (const cls of api.classes) {
    const instanceMembers = cls.members.filter(
      (member) => !member.static && member.kind !== "constructor",
    );
    // A documented namespace such as FileState has only static accessors, but
    // the global `lumine.FileState` property is typed as that namespace. Feed
    // those constants to the same type-based completion path as instance
    // members without mixing static and instance APIs on ordinary classes.
    const completionMembers = instanceMembers.length
      ? instanceMembers
      : cls.members.filter((member) => member.static && member.kind !== "constructor");
    const properties = completionMembers
      .filter((member) => member.kind === "property" || member.kind === "get")
      .map(propertySuggestion)
      .sort(compareNames);
    const methods = completionMembers
      .filter((member) => member.kind === "method")
      .map(methodSuggestion)
      .sort(compareNames);
    if (properties.length || methods.length) completions[cls.name] = properties.concat(methods);
  }
  return completions;
}

function update() {
  const api = extractApi({ editorRoot, parser });
  if (api.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`Unsupported API schema ${api.schemaVersion}; expected ${SCHEMA_VERSION}.`);
  }
  const completions = completionsFromApi(api);
  const generated = `${JSON.stringify(completions, null, "  ")}\n`;
  const classCount = Object.keys(completions).length;
  const itemCount = Object.values(completions).reduce((count, items) => count + items.length, 0);

  if (process.argv.includes("--check")) {
    const committed = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : null;
    if (committed !== generated) {
      throw new Error(
        `completions.json is out of date (${classCount} classes and ${itemCount} suggestions generated).`,
      );
    }
    console.log(`completions.json is current: ${classCount} classes and ${itemCount} suggestions`);
    return;
  }

  fs.writeFileSync(outputPath, generated);
  console.log(`Updated ${classCount} classes and ${itemCount} suggestions in completions.json`);
}

try {
  update();
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}

# autocomplete-lumine

Autocompletions for the Lumine API.

## Features

- **API completions**: suggests properties and methods available on the `lumine.` global.
- **Package-aware**: activates only while editing files inside a Lumine package.
- **Language support**: works in JavaScript and CoffeeScript source.

## Installation

To install `autocomplete-lumine` search for _autocomplete-lumine_ in the Install pane of the Lumine settings or run `lumine --install lumine-code/autocomplete-lumine`.

## Services

- **autocomplete.provider** (`1.0.0`): provided to supply `lumine.` API suggestions to autocomplete.

## Regenerating completions

Install the development dependencies and point the update script at any Lumine editor checkout:

```sh
npm install
npm run update -- --editor /path/to/lumine
```

`LUMINE_CORE_ROOT` may be set instead of passing `--editor`.
Use `npm run update:check -- --editor /path/to/lumine` to verify the committed
completion data without rewriting it. Both commands use the canonical JSDoc
extractor from the selected editor checkout.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!

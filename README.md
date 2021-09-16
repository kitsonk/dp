# dp

A prototype npm `package.json` to [import-map]() tool for Deno CLI.

## Usage

```
USAGE:
    dp [OPTIONS] <PACKAGE>

OPTIONS:
    -c, --cdn <CDN>         The CDN used to generate remote URLs for the
                            generated import map. Valid values are "skypack",
                            "esm", "jspm", or "unpkg". Defaults to "skypack".
    -d, --dev               Include "devDependencies" from the package.json in
                            the generated import map.
    -h, --help              Print this help text.
        --opt, --optional   Include "optionalDependencies" from the package.json
                            in the generated import map.
    -o, --out <FILE>        Output the generated import map to the specified
                            file.
    -p, --peer              Include "peerDependencies" from the package.json in
                            the generated import map.
    -v, --version           Print version information about the script.

ARGS:
    <PACKAGE>  The file path to the package/package.json or a URL to a
               package.json file.
```

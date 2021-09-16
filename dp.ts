#!/usr/bin/env -S deno run --allow-read --allow-write=.

import * as colors from "https://deno.land/std@0.107.0/fmt/colors.ts";
import * as flags from "https://deno.land/std@0.107.0/flags/mod.ts";
import { join } from "https://deno.land/std@0.107.0/path/mod.ts";
import semver from "https://cdn.skypack.dev/semver";

const VERSION = "0.1.0";

const HELP_TEXT = `dp ${VERSION}

A command line tool for converting npm packages to Deno.

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
`;

function assert(cond: unknown, msg = "Assertion failed."): asserts cond {
  if (!cond) {
    throw new Error(msg);
  }
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

interface ImportMap {
  imports: Record<string, string>;
  scopes?: Record<string, Record<string, string>>;
}

const cdns = {
  skypack(pkg: string, version?: string): string {
    return version
      ? `https://cdn.skypack.dev/${pkg}@${encodeURI(version)}`
      : `https://cdn.skypack.dev/${pkg}/`;
  },
  esm(pkg: string, version?: string): string {
    return version
      ? `https://esm.sh/${pkg}@${encodeURI(version)}`
      : `https://esm.sh/${pkg}`;
  },
  jspm(pkg: string, version?: string): string {
    return version
      ? `https://jspm.dev/npm:${pkg}@${encodeURI(version)}`
      : `https://jspm.dev/npm:${pkg}`;
  },
  unpkg(pkg: string, version?: string): string {
    return version
      ? `https://unpkg.com/${pkg}@${encodeURI(version)}`
      : `https://unpkg.com/${pkg}`;
  },
} as const;

type Cdn = keyof typeof cdns;

const cdnNames = Object.keys(cdns) as Cdn[];

function assertCDN(value: unknown): asserts value is Cdn {
  // deno-lint-ignore no-explicit-any
  if (!(typeof value === "string" && cdnNames.includes(value as any))) {
    throw new TypeError(
      `CDN value must be one of "${
        cdnNames.join(`", "`)
      }". Received "${value}".`,
    );
  }
}

async function readPackageJson(path: string): Promise<PackageJson> {
  if (path.match(/^(file|https?|blob|data):/)) {
    const url = new URL(path);
    if (url.protocol !== "file") {
      if (path.startsWith("http")) {
        const { host } = url;
        await Deno.permissions.request({ name: "net", host });
      }
      try {
        const response = await fetch(url);
        if (response.status !== 200) {
          console.error(
            `${"error:"} received status "${response.status} ${response.text}" when fetching "${path}".`,
          );
          Deno.exit(1);
        }
        return (await fetch(url)).json();
      } catch (e) {
        console.error(
          `${"error:"} fetching "${path}".\n  ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
        Deno.exit(1);
      }
    } else {
      const text = await Deno.readTextFile(url);
      const value = JSON.parse(text);
      assert(typeof value === "object");
      return value;
    }
  }
  await Deno.permissions.request({ name: "read", path });
  let stat = await Deno.stat(path);
  if (stat.isDirectory) {
    path = join(path, "package.json");
    stat = await Deno.stat(path);
  }
  if (!stat.isFile) {
    console.error(
      `${colors.red("error:")} the path of "${path}" does not exist.`,
    );
    Deno.exit(1);
  }
  const text = await Deno.readTextFile(path);
  const value = JSON.parse(text);
  assert(typeof value === "object");
  return value;
}

function addImports(
  imports: Record<string, string>,
  dependencies: Record<string, string>,
  cdn: Cdn,
) {
  for (const [key, value] of Object.entries(dependencies)) {
    if (key.startsWith("@types")) {
      console.warn(
        `${
          colors.yellow("warning:")
        } type only dependency "${key}" found. Skipping.`,
      );
      continue;
    }
    let importURL: string;
    const version: string | null | undefined = semver.valid(value);
    if (version) {
      importURL = cdns[cdn](key, version);
    } else {
      const range: string | null = semver.validRange(value);
      if (range) {
        importURL = cdns[cdn](key, range);
      } else {
        if (!value || value === "*") {
          importURL = cdns[cdn](key);
        } else if (value.match(/^git(\+|:)/)) {
          console.warn(
            `${
              colors.yellow("warning:")
            } git dependency of "${value}" for "${key}" is not supported currently. Skipping.`,
          );
          continue;
        } else if ([".", "~", ".", "/"].includes(key[0])) {
          console.warn(
            `${
              colors.yellow("warning:")
            } local path of "${value}" for "${key}" is not supported currently. Skipping.`,
          );
          continue;
        } else if (value.match(/^https?:/)) {
          console.warn(
            `${
              colors.yellow("warning:")
            } remote URL of "${value}" for "${key}" is not supported currently. Skipping.`,
          );
          continue;
        } else if (value.includes("/")) {
          console.warn(
            `${
              colors.yellow("warning:")
            } GitHub URL of "${value}" for "${key}" is not supported currently. Skipping.`,
          );
          continue;
        } else {
          importURL = cdns[cdn](key, value);
        }
      }
    }
    imports[key] = importURL;
  }
}

function getImports(
  packageJson: PackageJson,
  keys: (keyof PackageJson)[],
  cdn: Cdn,
): Record<string, string> {
  const imports: Record<string, string> = {};
  for (const key of keys) {
    const deps = packageJson[key];
    if (deps) {
      addImports(imports, deps, cdn);
    }
  }
  return imports;
}

async function main() {
  const { _: args, cdn, dev, help, optional, out, peer, version } = flags.parse(
    Deno.args,
    {
      alias: {
        "cdn": ["c"],
        "dev": ["d"],
        "help": ["h"],
        "optional": ["opt"],
        "out": ["o"],
        "peer": ["p"],
        "version": ["v"],
      },
      boolean: ["dev", "help", "optional", "peer", "version"],
      default: {
        "cdn": "skypack",
      },
      string: ["out"],
    },
  );

  if (version) {
    console.warn(`dp ${VERSION}\n`);
    return;
  }

  if (help) {
    console.warn(HELP_TEXT);
    return;
  }

  assertCDN(cdn);
  assert(
    args.length === 1,
    `Only a single argument is accepted. Received ${args.length}.`,
  );
  const [path] = args;
  assert(typeof path === "string", "Supplied path must be a string.");

  const keys: (keyof PackageJson)[] = ["dependencies"];
  if (dev) {
    keys.push("devDependencies");
  }
  if (optional) {
    keys.push("optionalDependencies");
  }
  if (peer) {
    keys.push("peerDependencies");
  }
  keys.reverse();

  console.warn(`${colors.green("Loading")} ${colors.yellow(`"${path}"`)}`);
  const packageJson = await readPackageJson(path);
  const importMap: ImportMap = {
    imports: getImports(packageJson, keys, cdn),
  };
  const importMapStr = JSON.stringify(importMap, undefined, "  ");
  if (out) {
    console.warn(`${colors.green("Writing")} ${colors.yellow(`"${out}"`)}`);
    await Deno.permissions.request({ name: "read", path: out });
    await Deno.writeTextFile(out, importMapStr);
  } else {
    console.log(JSON.stringify(importMap, undefined, "  "));
  }
}

await main();

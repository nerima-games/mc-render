import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

// Adapted from mc-kernel's scripts/verify-package.mjs (Wave 0), not copied
// verbatim: kernel's version additionally (a) derives its export map from
// `export * from './domain/<name>.js'` entries in src/index.ts and requires
// package.json#exports to declare a matching `./domain/<name>` subpath for
// each one, and (b) runs a ~250-line probe hard-coded to kernel's own
// domain functions (fixedClock, launchArrow, blockHardnessOf, ...). Neither
// applies here: mc-render's src/index.ts re-exports without a `.js`
// extension (kernel's regex would not match a single entry point and would
// throw "src/index.ts must declare at least one domain entrypoint"), and
// package.json#exports declares only the root "." entry (docs/public-api.md
// §8 names src/index.ts as the sole source of truth for the public surface
// and does not declare a `./browser` subpath, so this script does not
// require one — see the Wave 0 report for the src/browser.ts finding).
// What is kept: packing the tarball, checking every declared export target
// actually landed in the archive, installing the archive in a scratch
// consumer, and probing that every declared export resolves to a module
// with at least one runtime export.

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const packageName = manifest.name;
const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;
const typeScriptCompiler = join(root, "node_modules", "typescript", "bin", "tsc");

const commandLabel = (command, args) => `${command} ${args.join(" ")}`;

const run = (command, args, { timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS, ...options } = {}) => {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: "inherit",
    timeout: timeoutMs,
    killSignal: "SIGTERM",
    ...options,
  });
  if (result.error) {
    throw new Error(`${commandLabel(command, args)} failed: ${result.error.message}`);
  }
  if (result.signal) {
    throw new Error(`${commandLabel(command, args)} terminated by ${result.signal}`);
  }
  if (result.status !== 0) {
    throw new Error(`${commandLabel(command, args)} exited with status ${result.status}`);
  }
  return result;
};

const capture = (command, args, { timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS, ...options } = {}) => {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    timeout: timeoutMs,
    killSignal: "SIGTERM",
    ...options,
  });
  if (result.error) {
    throw new Error(`${commandLabel(command, args)} failed: ${result.error.message}`);
  }
  if (result.signal) {
    throw new Error(`${commandLabel(command, args)} terminated by ${result.signal}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `${commandLabel(command, args)} exited with status ${result.status}\n${result.stdout ?? ""}${result.stderr ?? ""}`,
    );
  }
  return result.stdout;
};

const exportEntries = Object.entries(manifest.exports ?? {});
if (exportEntries.length === 0) {
  throw new Error("package.json must declare at least one export");
}

const targetPaths = new Set();
for (const [subpath, target] of exportEntries) {
  if (typeof target === "string") {
    targetPaths.add(target);
  } else if (typeof target !== "object" || target === null) {
    throw new Error(`Unsupported export declaration for ${subpath}`);
  } else {
    for (const field of ["types", "import", "default"]) {
      if (typeof target[field] === "string") {
        targetPaths.add(target[field]);
      }
    }
  }
}
if (targetPaths.size === 0) {
  throw new Error("package.json exports do not contain any target paths");
}

const archiveEntryFor = (targetPath) => `package/${targetPath.replace(/^\.\//, "")}`;
const importSpecifiers = exportEntries.map(([subpath]) => (subpath === "." ? packageName : `${packageName}${subpath.slice(1)}`));
const rootSpecifierIndex = importSpecifiers.indexOf(packageName);
if (rootSpecifierIndex === -1) {
  throw new Error(`Package exports must include the root entry ${packageName}`);
}
const typeConsumerSubpathImports = importSpecifiers
  .map((specifier, index) => `import * as packageExport${index} from ${JSON.stringify(specifier)}`)
  .join("\n");
const typeConsumerSubpathUses = importSpecifiers.map((_, index) => `  packageExport${index}`).join(",\n");
const peerDependencies = manifest.peerDependencies ?? {};

const workspace = await mkdtemp(join(tmpdir(), "mc-render-package-"));
const packDirectory = join(workspace, "pack");
const consumerDirectory = join(workspace, "consumer");
await mkdir(packDirectory);
await mkdir(consumerDirectory);

try {
  run("pnpm", ["pack", "--pack-destination", packDirectory], { timeoutMs: 60_000 });

  const archives = (await readdir(packDirectory)).filter((entry) => entry.endsWith(".tgz"));
  if (archives.length !== 1) {
    throw new Error(`Expected exactly one package archive, found ${archives.length}`);
  }

  const archivePath = join(packDirectory, archives[0]);
  const archiveStat = await stat(archivePath);
  if (archiveStat.size === 0) {
    throw new Error("Package archive is empty");
  }

  const archiveEntries = new Set(
    capture("tar", ["-tzf", archivePath], { cwd: root, timeoutMs: 30_000 })
      .trim()
      .split("\n")
      .filter(Boolean),
  );
  for (const targetPath of targetPaths) {
    const archiveEntry = archiveEntryFor(targetPath);
    if (!archiveEntries.has(archiveEntry)) {
      throw new Error(`Package archive is missing export target ${archiveEntry}`);
    }
  }

  await writeFile(
    join(consumerDirectory, "package.json"),
    `${JSON.stringify(
      {
        name: "mc-render-package-consumer",
        private: true,
        type: "module",
        dependencies: peerDependencies,
      },
      null,
      2,
    )}\n`,
  );
  // This package's own `dependencies` (mc-kernel, mc-meshing, mc-sim,
  // mc-worldgen) resolve from GitHub Packages, not npmjs.com — the scratch
  // consumer directory needs the same scope mapping as this repository's own
  // .npmrc, or `npm install` 404s on the very first @nerima-games/* package
  // it tries to fetch, and it needs a token or that 404 becomes an E401.
  // npmTokenPlaceholder is npm's own env-var expansion syntax for .npmrc
  // values — npm substitutes it from the process environment when it reads
  // the file. The token value itself is never written to disk; only the
  // caller's environment (CI sets NODE_AUTH_TOKEN before this script runs)
  // has to carry it. Built via String.fromCharCode rather than a literal
  // `${NODE_AUTH_TOKEN}` string: oxlint's no-template-curly-in-string rule
  // (correctly, in every other case) flags a literal `${...}` inside a
  // non-template string as a forgotten template literal, which this is not
  // — and two adjacent string-literal pieces trip no-useless-concat instead.
  const npmTokenPlaceholder = `${String.fromCharCode(36)}{NODE_AUTH_TOKEN}`;
  await writeFile(
    join(consumerDirectory, ".npmrc"),
    `@nerima-games:registry=https://npm.pkg.github.com\n//npm.pkg.github.com/:_authToken=${npmTokenPlaceholder}\n`,
  );
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", archivePath], {
    cwd: consumerDirectory,
    timeoutMs: 180_000,
  });

  const probe = `
    const specifiers = ${JSON.stringify(importSpecifiers)};
    const modules = await Promise.all(specifiers.map((specifier) => import(specifier)));
    modules.forEach((module, index) => {
      if (Object.keys(module).length === 0) {
        throw new Error(\`Exported module \${specifiers[index]} has no runtime exports\`);
      }
    });
    console.log(\`verified ${packageName} exports: \${specifiers.join(', ')}\`);
  `;
  run("node", ["--input-type=module", "--eval", probe], { cwd: consumerDirectory, timeoutMs: 30_000 });

  const typeConsumerSource = `
${typeConsumerSubpathImports}

const declaredPackageExports: readonly object[] = [
${typeConsumerSubpathUses}
]
if (declaredPackageExports.length !== ${importSpecifiers.length}) {
  throw new Error('The TypeScript consumer did not load every declared package export')
}
`;
  await writeFile(join(consumerDirectory, "consumer.ts"), typeConsumerSource.trimStart());
  await writeFile(
    join(consumerDirectory, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          noEmit: true,
          skipLibCheck: false,
        },
        files: ["consumer.ts"],
      },
      null,
      2,
    )}\n`,
  );
  run(process.execPath, [typeScriptCompiler, "--project", join(consumerDirectory, "tsconfig.json"), "--pretty", "false"], {
    cwd: consumerDirectory,
    timeoutMs: 30_000,
  });
  console.log(`verified ${packageName} declaration consumer typecheck`);

  console.log(`verified package archive ${relative(root, archivePath)}`);
} finally {
  await rm(workspace, { recursive: true, force: true });
}

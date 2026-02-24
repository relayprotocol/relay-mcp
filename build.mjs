import ts from "typescript";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const files = execSync('find src -name "*.ts"').toString().trim().split("\n");
const options = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  outDir: "dist",
  rootDir: "src",
  esModuleInterop: true,
  skipLibCheck: true,
  sourceMap: true,
};

fs.rmSync("dist", { recursive: true, force: true });

for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  const result = ts.transpileModule(source, {
    compilerOptions: options,
    fileName: file,
  });
  const outFile = file.replace("src/", "dist/").replace(".ts", ".js");
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, result.outputText);
  if (result.sourceMapText) {
    fs.writeFileSync(outFile + ".map", result.sourceMapText);
  }
}

// Add shebang to entry point for bin usage
const entryPoint = "dist/index.js";
const entryContent = fs.readFileSync(entryPoint, "utf8");
if (!entryContent.startsWith("#!")) {
  fs.writeFileSync(entryPoint, `#!/usr/bin/env node\n${entryContent}`);
}
fs.chmodSync(entryPoint, 0o755);

console.log(`Built ${files.length} files → dist/`);

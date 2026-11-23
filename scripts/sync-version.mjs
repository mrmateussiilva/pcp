#!/usr/bin/env node
// Sincroniza a versão do package.json (fonte da verdade) com src-tauri/Cargo.toml
// e src-tauri/Cargo.lock. É chamado automaticamente pelo hook "version" do npm,
// ou seja, `npm version patch|minor|major` já deixa tudo consistente e cria a tag.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const cargoToml = join(root, "src-tauri", "Cargo.toml");
const toml = readFileSync(cargoToml, "utf8");
const newToml = toml.replace(
  /(\[package\][\s\S]*?\nversion\s*=\s*")[^"]+(")/,
  `$1${version}$2`,
);
if (newToml === toml && !toml.includes(`version = "${version}"`)) {
  console.error("sync-version: não encontrei a versão em [package] do Cargo.toml");
  process.exit(1);
}
writeFileSync(cargoToml, newToml);

const cargoLock = join(root, "src-tauri", "Cargo.lock");
const lock = readFileSync(cargoLock, "utf8");
writeFileSync(
  cargoLock,
  lock.replace(/(name = "pcp-tauri"\r?\nversion = ")[^"]+(")/, `$1${version}$2`),
);

console.log(`sync-version: v${version} aplicada em Cargo.toml e Cargo.lock`);


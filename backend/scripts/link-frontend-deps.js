#!/usr/bin/env node
/**
 * Enlaza en frontend/node_modules las dependencias que npm workspaces
 * deja en la raíz, para que Next en dev (root = frontend) las resuelva
 * sin indexar todo el monorepo (evita consumo excesivo de RAM).
 * Ejecutar desde la raíz del repo: node scripts/link-frontend-deps.js
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const frontendModules = path.join(root, 'frontend', 'node_modules');
const rootModules = path.join(root, 'node_modules');

if (!fs.existsSync(rootModules)) {
  console.error(
    '[link-frontend-deps] No existe node_modules en la raíz del proyecto.\n' +
    'Ejecuta desde la raíz: npm install\n' +
    'Luego vuelve a levantar el frontend (npm run dev en frontend/).'
  );
  process.exit(1);
}

if (!fs.existsSync(frontendModules)) {
  fs.mkdirSync(frontendModules, { recursive: true });
}

function linkDir(target, linkPath) {
  if (!fs.existsSync(target) || fs.existsSync(linkPath)) return;
  try {
    const relative = path.relative(path.dirname(linkPath), target);
    fs.symlinkSync(relative, linkPath);
    console.log('Linked:', path.relative(frontendModules, linkPath));
  } catch (e) {
    console.warn('Skip', linkPath, e.message);
  }
}

// Paquetes en la raíz (no enlazar workspaces ni .bin)
const rootEntries = fs.readdirSync(rootModules, { withFileTypes: true });
const skipNames = new Set(['.bin', 'frontend', 'app']);
for (const ent of rootEntries) {
  if (ent.name.startsWith('.') || skipNames.has(ent.name)) continue;
  const target = path.join(rootModules, ent.name);
  const linkPath = path.join(frontendModules, ent.name);
  if (ent.isDirectory()) {
    linkDir(target, linkPath);
  }
}
// Scoped: @scope/package
const scopeDir = path.join(rootModules, '@radix-ui');
if (fs.existsSync(scopeDir)) {
  const scoped = fs.readdirSync(scopeDir, { withFileTypes: true });
  const frontendScope = path.join(frontendModules, '@radix-ui');
  if (!fs.existsSync(frontendScope)) fs.mkdirSync(frontendScope, { recursive: true });
  for (const ent of scoped) {
    if (!ent.isDirectory()) continue;
    const target = path.join(scopeDir, ent.name);
    const linkPath = path.join(frontendScope, ent.name);
    linkDir(target, linkPath);
  }
}
const scopeFloating = path.join(rootModules, '@floating-ui');
if (fs.existsSync(scopeFloating)) {
  const frontendFloating = path.join(frontendModules, '@floating-ui');
  if (!fs.existsSync(frontendFloating)) fs.mkdirSync(frontendFloating, { recursive: true });
  const subs = fs.readdirSync(scopeFloating, { withFileTypes: true });
  for (const ent of subs) {
    if (!ent.isDirectory()) continue;
    linkDir(path.join(scopeFloating, ent.name), path.join(frontendFloating, ent.name));
  }
}

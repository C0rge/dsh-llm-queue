#!/usr/bin/env node
/**
 * install.mjs — 把 dsh-llm-queue 装进指定 DSH profile
 *
 * 做三件事（都可回滚，见 uninstall.mjs）：
 *   1. 在 <profile>/node_modules/dsh-llm-queue 建一个 junction 指向本目录（源目录改了即时生效）
 *   2. 在 profile 的 package.json 里登记依赖（link: 形式）
 *   3. 把 dsh-llm-queue 追加到 dsh.profile.bundles，使它的 bundle patch 参与组合
 *
 * 用法：node install.mjs [--profile desktop] [--dry-run]
 */

import { existsSync, readFileSync, writeFileSync, copyFileSync, symlinkSync, lstatSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_NAME = 'dsh-llm-queue';
const sourceDir = dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const profileIndex = argv.indexOf('--profile');
const profileName = profileIndex >= 0 ? argv[profileIndex + 1] : 'desktop';
if (!profileName) {
  console.error('用法：node install.mjs [--profile desktop] [--dry-run]');
  process.exit(2);
}

const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');
const profileDir = join(dshHome, 'profiles', profileName);
const manifestPath = join(profileDir, 'package.json');

if (!existsSync(manifestPath)) {
  console.error(`找不到 profile：${manifestPath}`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.dsh ??= {};
manifest.dsh.profile ??= {};
manifest.dsh.profile.bundles ??= [];
manifest.dependencies ??= {};

const linkTarget = join(profileDir, 'node_modules', PACKAGE_NAME);
const linkSpec = `link:${relative(profileDir, sourceDir).split('\\').join('/')}`;

const changes = [];
if (manifest.dependencies[PACKAGE_NAME] !== linkSpec) {
  changes.push(`dependencies["${PACKAGE_NAME}"] = "${linkSpec}"`);
  manifest.dependencies[PACKAGE_NAME] = linkSpec;
}
if (!manifest.dsh.profile.bundles.includes(PACKAGE_NAME)) {
  changes.push(`dsh.profile.bundles += "${PACKAGE_NAME}"`);
  manifest.dsh.profile.bundles.push(PACKAGE_NAME);
}

const needsLink = !existsSync(linkTarget);

console.log(`profile : ${profileDir}`);
console.log(`source  : ${sourceDir}`);
console.log(`link    : ${linkTarget} -> ${sourceDir}`);
console.log(`manifest: ${changes.length ? changes.join('; ') : '已是最新'}`);

if (dryRun) {
  console.log('\n[dry-run] 未做任何修改');
  process.exit(0);
}

if (needsLink) {
  symlinkSync(sourceDir, linkTarget, 'junction');
  console.log('已创建 junction');
} else {
  const stat = lstatSync(linkTarget);
  console.log(stat.isSymbolicLink() ? 'junction 已存在' : '注意：目标已存在且不是链接');
}

if (changes.length > 0) {
  const backup = `${manifestPath}.bak-llm-queue`;
  if (!existsSync(backup)) copyFileSync(manifestPath, backup);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`已更新 package.json（备份：${backup}）`);
}

console.log(`
完成。接下来：
  1. 完全退出并重新启动 DSH（插件在启动时参与组合）
  2. 打开面板：DSH 本地服务的 /llm-queue
     - 桌面端默认 http://127.0.0.1:3080/llm-queue（端口以实际监听为准）
  3. 想撤掉：node uninstall.mjs --profile ${profileName}
`);

#!/usr/bin/env node
/**
 * uninstall.mjs — 从 DSH profile 里摘掉 dsh-llm-queue
 *
 * 反向执行 install.mjs：删 junction、去掉依赖、从 bundles 里移除。
 * 不碰 profile 的 cordis.patch.yml，也不碰 $DSH_HOME/llm-queue/config.json。
 *
 * 用法：node uninstall.mjs [--profile desktop] [--purge-config]
 */

import { existsSync, readFileSync, writeFileSync, lstatSync, unlinkSync, rmdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PACKAGE_NAME = 'dsh-llm-queue';
const argv = process.argv.slice(2);
const profileIndex = argv.indexOf('--profile');
const profileName = profileIndex >= 0 ? argv[profileIndex + 1] : 'desktop';
const purgeConfig = argv.includes('--purge-config');

const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');
const profileDir = join(dshHome, 'profiles', profileName);
const manifestPath = join(profileDir, 'package.json');
const linkTarget = join(profileDir, 'node_modules', PACKAGE_NAME);

if (!existsSync(manifestPath)) {
  console.error(`找不到 profile：${manifestPath}`);
  process.exit(1);
}

if (existsSync(linkTarget)) {
  const stat = lstatSync(linkTarget);
  if (stat.isSymbolicLink() || stat.isDirectory()) {
    try {
      unlinkSync(linkTarget);
    } catch {
      try {
        rmdirSync(linkTarget);
      } catch {
        rmSync(linkTarget, { recursive: false, force: true });
      }
    }
    console.log('已移除 node_modules 链接');
  }
} else {
  console.log('node_modules 里没有链接，跳过');
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
let changed = false;
if (manifest.dependencies && PACKAGE_NAME in manifest.dependencies) {
  delete manifest.dependencies[PACKAGE_NAME];
  changed = true;
}
if (manifest.dsh?.profile?.bundles?.includes(PACKAGE_NAME)) {
  manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter((name) => name !== PACKAGE_NAME);
  changed = true;
}
if (changed) {
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log('已从 package.json 移除依赖与 bundle 登记');
} else {
  console.log('package.json 无需修改');
}

const configFile = join(dshHome, 'llm-queue', 'config.json');
if (purgeConfig && existsSync(configFile)) {
  rmSync(configFile, { force: true });
  console.log('已删除面板保存的配置');
}

console.log(`\n完成。重启 DSH 后生效。${purgeConfig ? '' : `\n（面板配置仍保留在 ${configFile}，需要一并删除请加 --purge-config）`}`);

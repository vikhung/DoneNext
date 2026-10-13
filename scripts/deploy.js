'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const DIST_DIR  = path.join(REPO_ROOT, 'dist');

const RAR_CANDIDATES = [
  'C:\\Program Files\\WinRAR\\rar.exe',
  'C:\\Program Files (x86)\\WinRAR\\rar.exe',
  'rar',
];

function findRarExe() {
  for (const candidate of RAR_CANDIDATES) {
    if (candidate === 'rar' || fs.existsSync(candidate)) return candidate;
  }
  return 'rar';
}

function git(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
}

// 取得本次異動的檔案（相對於 HEAD 的新增/修改，以及未追蹤的新檔案），刪除的檔案不列入
function getChangedFiles() {
  const diffLines = git(['diff', '--name-status', 'HEAD']).split('\n').filter(Boolean);
  const tracked = diffLines.map(line => {
    const parts = line.split('\t');
    const status = parts[0];
    if (status.startsWith('D')) return null;
    return status.startsWith('R') || status.startsWith('C') ? parts[2] : parts[1];
  }).filter(Boolean);

  const untracked = git(['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean);

  return [...new Set([...tracked, ...untracked])];
}

function resetDistDir() {
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(DIST_DIR, { recursive: true });
}

function copyChangedFiles(files) {
  for (const relPath of files) {
    const src = path.join(REPO_ROOT, relPath);
    if (!fs.existsSync(src)) continue;
    const dest = path.join(DIST_DIR, relPath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

function timestamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function compressToRar(archivePath) {
  const rarExe = findRarExe();
  try {
    execFileSync(rarExe, ['a', '-r', archivePath, '.'], { cwd: DIST_DIR, stdio: 'inherit' });
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error('找不到 rar.exe，請安裝 WinRAR 或將 rar.exe 加入 PATH');
    }
    throw err;
  }
}

function main() {
  const files = getChangedFiles();
  resetDistDir();

  if (files.length === 0) {
    console.log('沒有偵測到異動的檔案，dist 目錄已清空，略過部署封裝。');
    return;
  }

  copyChangedFiles(files);

  const archivePath = path.join(REPO_ROOT, `dist_${timestamp()}.rar`);
  compressToRar(archivePath);

  console.log(`已複製 ${files.length} 個異動檔案至 ${DIST_DIR}`);
  files.forEach(f => console.log(`  - ${f}`));
  console.log(`已建立封存檔：${archivePath}`);
}

main();

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

// 部署封存檔要包含的檔案與目錄（目錄以 / 結尾）：執行站台所需的程式，加上專案文件。
// 不含：.claude/、本部署腳本，以及被 .gitignore 排除的 data/、logs/、node_modules/、dist/。
const DEPLOY_PATHS = [
  // 程式
  'server.js',
  'package.json',
  'package-lock.json',
  'lib/',
  'public/',
  'scripts/install-service.js',
  'scripts/uninstall-service.js',
  // 文件
  'README.md',
  'CLAUDE.md',
  'LICENSE',
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

function isDeployFile(relPath) {
  return DEPLOY_PATHS.some(p => (p.endsWith('/') ? relPath.startsWith(p) : relPath === p));
}

// 取得所有要部署的檔案：不論是否已 commit，一律以工作目錄現況為準。
// 來源為 git 已追蹤的檔案加上未追蹤的新檔案（遵守 .gitignore），已刪除的檔案不列入。
function getDeployFiles() {
  // -z：以 NUL 分隔並輸出原始路徑，避免中文或含空白的檔名被加上引號跳脫
  const listed = git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean);
  return [...new Set(listed)]
    .filter(isDeployFile)
    .filter(relPath => fs.existsSync(path.join(REPO_ROOT, relPath)))
    .sort();
}

// dist 目錄只放封存檔：保留既有的 .rar（其他日期的封存），清掉其餘殘留內容
function prepareDistDir() {
  fs.mkdirSync(DIST_DIR, { recursive: true });
  for (const entry of fs.readdirSync(DIST_DIR)) {
    if (entry.toLowerCase().endsWith('.rar')) continue;
    fs.rmSync(path.join(DIST_DIR, entry), { recursive: true, force: true });
  }
}

// yyyymmdd
function dateStamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

// 直接從專案根目錄把檔案加入封存檔，保留相對路徑（lib/、public/ …）
function compressToRar(archivePath, files) {
  const rarExe = findRarExe();
  // 清單寫成檔案交給 rar（@listfile），避免檔案多時超過命令列長度上限
  const listFile = path.join(DIST_DIR, '.deploy-files.lst');
  fs.writeFileSync(listFile, files.join('\r\n') + '\r\n', 'utf8');
  try {
    // -scfl：清單檔為 UTF-8；-idq：只顯示錯誤訊息
    execFileSync(rarExe, ['a', '-scfl', '-idq', archivePath, `@${listFile}`], { cwd: REPO_ROOT, stdio: 'inherit' });
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error('找不到 rar.exe，請安裝 WinRAR 或將 rar.exe 加入 PATH');
    }
    throw err;
  } finally {
    fs.rmSync(listFile, { force: true });
  }
}

function main() {
  const files = getDeployFiles();
  if (files.length === 0) {
    console.log('找不到任何要部署的檔案，略過部署封裝。');
    return;
  }

  prepareDistDir();

  // 檔名：<專案目錄名稱>_deploy_yyyymmdd.rar；同一天重複執行時以最新內容取代
  const archiveName = `${path.basename(REPO_ROOT)}_deploy_${dateStamp()}.rar`;
  const archivePath = path.join(DIST_DIR, archiveName);
  fs.rmSync(archivePath, { force: true });

  compressToRar(archivePath, files);

  console.log(`已封裝 ${files.length} 個檔案：`);
  files.forEach(f => console.log(`  - ${f}`));
  console.log(`已建立封存檔：${archivePath}`);
}

main();

#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Check if we're in the correct directory
const packageJsonPath = path.join(__dirname, 'package.json');
if (!fs.existsSync(packageJsonPath)) {
  console.error('Error: package.json not found in current directory');
  process.exit(1);
}

// Read package.json to validate it
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

console.log(`Building ${packageJson.name} v${packageJson.version}...`);

// Create dist directory if it doesn't exist
const distDir = path.join(__dirname, 'dist');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// Copy essential files to dist
const filesToCopy = [
  'index.ts',
  'openclaw.plugin.json',
  'README.md',
  'package.json',
  'LICENSE'
];

for (const file of filesToCopy) {
  const srcPath = path.join(__dirname, file);
  const destPath = path.join(distDir, file);
  
  if (fs.existsSync(srcPath)) {
    fs.copyFileSync(srcPath, destPath);
    console.log(`✓ Copied ${file}`);
  } else {
    console.log(`- Skipped ${file} (not found)`);
  }
}

// Copy src directory
const srcDir = path.join(__dirname, 'src');
const destSrcDir = path.join(distDir, 'src');
if (fs.existsSync(srcDir)) {
  if (!fs.existsSync(destSrcDir)) {
    fs.mkdirSync(destSrcDir, { recursive: true });
  }
  
  const srcFiles = fs.readdirSync(srcDir);
  for (const file of srcFiles) {
    const srcFilePath = path.join(srcDir, file);
    const destFilePath = path.join(destSrcDir, file);
    if (fs.lstatSync(srcFilePath).isFile()) {
      fs.copyFileSync(srcFilePath, destFilePath);
    }
  }
  console.log(`✓ Copied src/ directory`);
}

// Copy utils file
const utilsPath = path.join(__dirname, 'utils.ts');
const destUtilsPath = path.join(distDir, 'utils.ts');
if (fs.existsSync(utilsPath)) {
  fs.copyFileSync(utilsPath, destUtilsPath);
  console.log(`✓ Copied utils.ts`);
}

console.log('\nBuild completed successfully!');
console.log('\nTo install this plugin locally:');
console.log('  cd /path/to/your/openclaw/project');
console.log('  openclaw plugins install -l ' + path.resolve(__dirname));
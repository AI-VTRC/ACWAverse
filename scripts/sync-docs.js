const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const sourceDir = path.join(rootDir, 'src');
const docsDir = path.join(rootDir, 'docs');

if (!fs.existsSync(sourceDir)) {
  throw new Error(`Source directory not found: ${sourceDir}`);
}

fs.rmSync(docsDir, { recursive: true, force: true });
fs.cpSync(sourceDir, docsDir, { recursive: true });
fs.writeFileSync(path.join(docsDir, '.nojekyll'), '');

console.log(`Synchronized ${sourceDir} to ${docsDir}`);

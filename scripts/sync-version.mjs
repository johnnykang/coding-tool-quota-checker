import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, '..');
const packageJsonPath = path.join(rootDir, 'package.json');
const manifestJsonPath = path.join(rootDir, 'au.jkang.codingtoolquotachecker.sdPlugin', 'manifest.json');

try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    const manifestJson = JSON.parse(fs.readFileSync(manifestJsonPath, 'utf-8'));

    const newVersion = packageJson.version;
    const oldVersion = manifestJson.Version;

    if (newVersion === oldVersion) {
        console.log(`Versions are already in sync: ${newVersion}`);
    } else {
        console.log(`Syncing version: ${oldVersion} -> ${newVersion}`);
        manifestJson.Version = newVersion;
        fs.writeFileSync(manifestJsonPath, JSON.stringify(manifestJson, null, 4) + '\n');
        console.log('Successfully updated manifest.json');
    }
} catch (error) {
    console.error('Error syncing version:', error.message);
    process.exit(1);
}

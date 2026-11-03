#!/usr/bin/env node
// Fails a release unless the pushed tag is exactly `v<package.json version>`.
const fs = require('node:fs');
const path = require('node:path');

function verifyReleaseTag(tag, version) {
  const expected = `v${version}`;
  if (tag !== expected) {
    throw new Error(`Release tag "${tag}" does not match manifest version; expected "${expected}".`);
  }
}

if (require.main === module) {
  const manifestPath = path.join(__dirname, '..', 'package.json');
  const { version } = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  try {
    verifyReleaseTag(process.env.GITHUB_REF_NAME ?? '', version);
    console.log(`Release tag v${version} matches package.json.`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { verifyReleaseTag };

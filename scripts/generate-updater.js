import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const version = process.env.GITHUB_REF_NAME?.replace(/^v/, "");
if (!version) {
  throw new Error("GITHUB_REF_NAME not set");
}

const releaseTag = `v${version}`;
const notes = `Release ${version}`;
const pubDate = new Date().toISOString();

const targetRoot = "apps/desktop/src-tauri/target";

const findMacBundleDir = (dir) => {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      if (fullPath.endsWith("/bundle/macos")) {
        return fullPath;
      }
      const found = findMacBundleDir(fullPath);
      if (found) return found;
    }
  }
  return null;
};

const macDir = findMacBundleDir(targetRoot);
if (!macDir) {
  throw new Error("No macOS bundle directory found under target");
}

const archiveFiles = readdirSync(macDir).filter((file) => file.endsWith(".app.tar.gz"));
const dmgFiles = readdirSync(macDir).filter((file) => file.endsWith(".dmg"));
const candidates = [...archiveFiles, ...dmgFiles];
if (!candidates.length) {
  throw new Error("No macOS artifacts found");
}
const findSignature = (dir, fileName) => {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      const nested = findSignature(fullPath, fileName);
      if (nested) return nested;
    } else if (entry === `${fileName}.sig`) {
      return fullPath;
    }
  }
  return null;
};

let archiveName = null;
let sigPath = null;
for (const candidate of candidates) {
  const found = findSignature(targetRoot, candidate);
  if (found) {
    archiveName = candidate;
    sigPath = found;
    break;
  }
}

if (!archiveName || !sigPath) {
  throw new Error(`Signature not found for any of: ${candidates.join(", ")}`);
}

const signature = readFileSync(sigPath, "utf8").trim();
const url = `https://github.com/bkeetman/folio/releases/download/${releaseTag}/${archiveName}`;

const manifest = {
  version,
  notes,
  pub_date: pubDate,
  platforms: {
    "darwin-aarch64": {
      url,
      signature,
    },
  },
};

writeFileSync("docs/latest.json", JSON.stringify(manifest, null, 2));

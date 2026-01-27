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

const findDmgDir = (dir) => {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      if (fullPath.endsWith("/bundle/dmg")) {
        return fullPath;
      }
      const found = findDmgDir(fullPath);
      if (found) return found;
    }
  }
  return null;
};

const dmgDir = findDmgDir(targetRoot);
if (!dmgDir) {
  throw new Error("No dmg directory found under target");
}

const dmgFiles = readdirSync(dmgDir).filter((file) => file.endsWith(".dmg"));
if (!dmgFiles.length) {
  throw new Error("No dmg artifacts found");
}

const dmgName = dmgFiles[0];
const sigPath = join(dmgDir, `${dmgName}.sig`);
const signature = readFileSync(sigPath, "utf8").trim();

const url = `https://github.com/bkeetman/folio/releases/download/${releaseTag}/${dmgName}`;

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

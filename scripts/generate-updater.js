import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import https from "node:https";

const fetchJson = (url, token) =>
  new Promise((resolve, reject) => {
    const headers = {
      "User-Agent": "folio-updater",
      Accept: "application/vnd.github+json",
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    https
      .get(url, { headers }, (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Request failed (${res.statusCode}): ${data}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(error);
          }
        });
      })
      .on("error", reject);
  });

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
const resolveArch = () => {
  const raw = process.env.TAURI_ARCH || process.env.RUNNER_ARCH;
  if (!raw) return null;
  const normalized = raw.toLowerCase();
  if (normalized === "arm64") return "aarch64";
  if (normalized === "x64") return "x86_64";
  return normalized;
};

const toReleaseAssetName = (fileName) => {
  const arch = resolveArch();
  if (!arch) return fileName;
  if (fileName.endsWith(".app.tar.gz")) {
    const base = fileName.replace(/\.app\.tar\.gz$/, "");
    return `${base}_${arch}.app.tar.gz`;
  }
  if (fileName.endsWith(".dmg")) {
    const base = fileName.replace(/\.dmg$/, "");
    if (base.includes(`_${arch}`)) return fileName;
    return `${base}_${arch}.dmg`;
  }
  return fileName;
};

const main = async () => {
  const version = process.env.GITHUB_REF_NAME?.replace(/^v/, "");
  if (!version) {
    throw new Error("GITHUB_REF_NAME not set");
  }

  const releaseTag = `v${version}`;
  const notes = `Release ${version}`;
  const pubDate = new Date().toISOString();

  const targetRoot = "apps/desktop/src-tauri/target";

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
  const repo = process.env.GITHUB_REPOSITORY || "bkeetman/folio";
  const token = process.env.GITHUB_TOKEN;
  const release = await fetchJson(`https://api.github.com/repos/${repo}/releases/tags/${releaseTag}`, token);
  const assets = release.assets || [];

  const findAsset = (predicate) => assets.find((asset) => predicate(asset.name));

  const arch = resolveArch();
  const macArchive = findAsset((name) => {
    if (!name.endsWith(".app.tar.gz")) return false;
    if (arch) return name.includes(`_${arch}.app.tar.gz`);
    return true;
  });
  const archiveUrl =
    macArchive?.browser_download_url ??
    `https://github.com/${repo}/releases/download/${releaseTag}/${toReleaseAssetName(archiveName)}`;

  const macDmgArm = findAsset((name) => name.endsWith("_aarch64.dmg"));
  const macDmgX64 = findAsset((name) => name.endsWith("_x64.dmg") || name.endsWith("_x86_64.dmg"));
  const macDmg = findAsset((name) => name.endsWith(".dmg"));
  const winMsi = findAsset((name) => name.endsWith(".msi"));
  const winExe = findAsset((name) => name.endsWith(".exe"));
  const linuxAppImage = findAsset((name) => name.endsWith(".AppImage"));
  const linuxDeb = findAsset((name) => name.endsWith(".deb"));
  const linuxRpm = findAsset((name) => name.endsWith(".rpm"));

  const manifest = {
    version,
    notes,
    pub_date: pubDate,
    platforms: {
      "darwin-aarch64": {
        url: archiveUrl,
        signature,
      },
    },
    downloads: {
      macos:
        macDmgArm?.browser_download_url || macDmgX64?.browser_download_url || macDmg?.browser_download_url
          ? {
              arm64: macDmgArm?.browser_download_url,
              x64: macDmgX64?.browser_download_url,
              dmg: macDmg?.browser_download_url,
            }
          : undefined,
      windows:
        winMsi?.browser_download_url || winExe?.browser_download_url
          ? {
              msi: winMsi?.browser_download_url,
              exe: winExe?.browser_download_url,
            }
          : undefined,
      linux:
        linuxAppImage?.browser_download_url || linuxDeb?.browser_download_url || linuxRpm?.browser_download_url
          ? {
              appimage: linuxAppImage?.browser_download_url,
              deb: linuxDeb?.browser_download_url,
              rpm: linuxRpm?.browser_download_url,
            }
          : undefined,
    },
  };

  writeFileSync("docs/latest.json", JSON.stringify(manifest, null, 2));
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

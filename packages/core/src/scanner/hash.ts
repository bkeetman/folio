import { createHash } from "crypto";
import { createReadStream } from "fs";

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  return new Promise((resolve, reject) => {
    const stream = createReadStream(filePath, { highWaterMark: 1024 * 1024 * 8 });
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

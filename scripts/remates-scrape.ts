import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { scrapeBiess } from "../src/libs/remates/biessHttpAdapter";
import { scrapeCfn } from "../src/libs/remates/cfnAdapter";
import { scrapeCj } from "../src/libs/remates/cjAdapter";
import { scrapeSri } from "../src/libs/remates/sriAdapter";
import { SourceScrapeResult } from "../src/libs/remates/types";

const valueOf = (name: string, fallback: string) => {
  const direct = process.argv.find((item) => item.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
};

const main = async () => {
  const requested = valueOf("--source", "all").toLocaleLowerCase();
  const supported = ["biess", "sri", "cj", "cfn"] as const;
  if (requested !== "all" && !supported.includes(requested as typeof supported[number])) throw new Error(`Fuente no implementada: ${requested}.`);
  const maxPages = Math.max(1, Number(valueOf("--max-pages", "30")));
  const maxItems = Math.max(1, Number(valueOf("--max-items", "10")));
  const outputRoot = path.resolve(valueOf("--output", "fixtures/remates"));
  const sources = requested === "all" ? supported : [requested as typeof supported[number]];
  const summary: Record<string, unknown> = {};

  for (const source of sources) {
    let result: SourceScrapeResult;
    if (source === "biess") result = await scrapeBiess({ maxPages, shouldDownload: () => true, maxDocuments: maxItems });
    else if (source === "sri") result = await scrapeSri({ shouldDownload: () => true, maxDocuments: maxItems });
    else if (source === "cj") result = await scrapeCj({ maxPages, shouldDownload: () => true, maxDocuments: maxItems });
    else result = await scrapeCfn({ shouldDownload: () => true, maxDocuments: maxItems });

    const output = path.join(outputRoot, source);
    await mkdir(output, { recursive: true });
    await writeFile(path.join(output, "listings.json"), JSON.stringify(result.auctions, null, 2));
    for (const document of result.documents) await writeFile(path.join(output, document.filename.replace(/[^a-z0-9_.-]+/gi, "-")), document.body);
    summary[source] = { ...result.metrics, output, documents: result.documents.map((item) => ({ id: item.auction.sourceAuctionId, filename: item.filename, sha256: item.sha256 })) };
  }

  console.log(JSON.stringify({ requested, maxPages, maxItems, sources: summary }, null, 2));
};

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

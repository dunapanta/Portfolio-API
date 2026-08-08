import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "playwright";
import { extractText } from "unpdf";

const main = async () => {
const args = new Set(process.argv.slice(2));
const valueOf = (name: string, fallback: string) => {
  const direct = process.argv.find((item) => item.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
};

const source = valueOf("--source", "biess").toLocaleLowerCase();
if (!["biess", "all"].includes(source)) throw new Error(`Fuente no implementada: ${source}. Actualmente BIESS es la fuente validada.`);
const headed = args.has("--headed") && !args.has("--headless");
const dryRun = args.has("--dry-run");
const maxPages = Math.max(1, Number(valueOf("--max-pages", "30")));
const maxItems = Math.max(1, Number(valueOf("--max-items", "10")));
const permanentOutput = path.resolve(valueOf("--output", "fixtures/remates/biess"));
const output = dryRun ? await mkdtemp(path.join(tmpdir(), "remates-ecuador-")) : permanentOutput;
await mkdir(output, { recursive: true });

const browser = await chromium.launch({ headless: !headed });
const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1440, height: 1100 } });
const offices = [15, 16];
const seen = new Set<string>();
const saved: Array<{ id: string; filename: string; sha256: string; nativeTextLength: number }> = [];
const pages: Array<{ office: number; page: number; items: number; newItems: number }> = [];

try {
  for (const office of offices) {
    await page.goto(`https://rematevirtual.biess.fin.ec/subasta_prendarios_web/web/portal_remate.xhtml?oficina=${office}`);
    let previousIds: string[] = [];
    for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
      const cards = page.locator('[id="formPortalId:bienesId_content"] .ui-datagrid-column');
      const count = await cards.count();
      const ids: string[] = [];
      for (let index = 0; index < count; index += 1) {
        const text = await cards.nth(index).innerText();
        const id = text.match(/BIESS-[A-Z]+-\d{4}-\d{4}/)?.[0];
        if (id) ids.push(id);
      }
      const newIds = ids.filter((id) => !seen.has(id));
      pages.push({ office, page: pageNumber, items: ids.length, newItems: newIds.length });
      const duplicatePage = ids.length === previousIds.length && ids.every((id, index) => id === previousIds[index]);
      if (!ids.length || duplicatePage || !newIds.length) break;

      for (let index = 0; index < count; index += 1) {
        const card = cards.nth(index);
        const text = await card.innerText();
        const id = text.match(/BIESS-[A-Z]+-\d{4}-\d{4}/)?.[0];
        if (!id || seen.has(id)) continue;
        seen.add(id);
        if (saved.length >= maxItems) continue;
        const link = card.getByText("DESCARGAR EXTRACTO DEL REMATE");
        const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
        const body = await download.createReadStream();
        if (!body) throw new Error(`No se pudo leer el PDF de ${id}.`);
        const chunks: Buffer[] = [];
        for await (const chunk of body) chunks.push(Buffer.from(chunk));
        const pdf = Buffer.concat(chunks);
        const destination = path.join(output, `${id}.pdf`);
        await writeFile(destination, pdf);
        let nativeTextLength = 0;
        try {
          nativeTextLength = (await extractText(new Uint8Array(pdf), { mergePages: true })).text.trim().length;
        } catch {
          nativeTextLength = 0;
        }
        saved.push({
          id,
          filename: download.suggestedFilename(),
          sha256: createHash("sha256").update(pdf).digest("hex"),
          nativeTextLength,
        });
      }

      previousIds = ids;
      const next = page.getByRole("link", { name: "Next Page" });
      if (!(await next.isEnabled())) break;
      await next.click();
      await page.waitForFunction(
        (expectedPage) => document.querySelector(".ui-paginator-current")?.textContent?.startsWith(`(${expectedPage} of`),
        pageNumber + 1
      );
    }
  }

  console.log(JSON.stringify({
    source: "BIESS",
    mode: headed ? "headed" : "headless",
    dryRun,
    pagesVisited: pages.length,
    pages,
    uniqueItems: seen.size,
    documentsDownloaded: saved.length,
    documents: saved,
    output,
  }, null, 2));
} finally {
  await browser.close();
  if (dryRun) await rm(output, { recursive: true, force: true });
}
};

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

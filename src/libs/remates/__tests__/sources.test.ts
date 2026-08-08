import { strict as assert } from "node:assert";
import { test } from "node:test";

import { parseCfnCarousel } from "../cfnAdapter";
import { parseCjResults } from "../cjAdapter";
import { parseEcuadorMoney } from "../normalizer";
import { parseSriAuctions } from "../sriAdapter";

test("money accepts Ecuadorian and US separators used by the official portals", () => {
  assert.equal(parseEcuadorMoney("USD 251.967,44"), 251967.44);
  assert.equal(parseEcuadorMoney("120,802.87"), 120802.87);
});

test("SRI pairs the real-estate listing with its direct official notice", () => {
  const html = `<p><b>BODEGA 1</b></p><p><strong>Lugar y fecha de la diligencia:</strong> Guayaquil, 14 de septiembre de 2026 <strong>Base para el remate:</strong> $28.181,44 <strong>Avalúo del bien:</strong> $56.362,87 <a href="https://www.sri.gob.ec/o/sri-portlet-biblioteca-alfresco-internet/descargar/109d706c-4b29-478d-955e-450692d8fdca/DZ8-COAVARC26-00000005.pdf">VER AVISO DE REMATE</a></p>`;
  const [auction] = parseSriAuctions(html, "https://www.sri.gob.ec/remates-y-subastas-2026");
  assert.equal(auction.sourceAuctionId, "SRI-DZ8-COAVARC26-00000005");
  assert.equal(auction.appraisalValue, 56362.87);
  assert.equal(auction.rawListingData.auctionBaseValue, 28181.44);
  assert.equal(auction.publicationStartAt?.slice(0, 10), "2026-09-14");
});

test("Judicatura parses a RichFaces result without trusting the image payload", () => {
  const html = `<a id="tablaResultados:down_ds_2"></a><tr id="tablaResultados:0"><td id="tablaResultados:0:j_idt676"><span>EC-RJ-154503</span></td><td id="tablaResultados:0:j_idt679"><span>ago, 11 2026</span></td><td id="tablaResultados:0:j_idt682">AZUAY <br />CUENCA</td><td id="tablaResultados:0:j_idt687">Edificio</td><td id="tablaResultados:0:j_idt693"><span>Primer Señalamiento</span></td><td id="tablaResultados:0:j_idt696"><span>400,440.80</span></td><td id="tablaResultados:0:j_idt699"><span>400,440.80</span><span> (100%)</span></td></tr>`;
  const result = parseCjResults(html, "urban", 1);
  assert.equal(result.totalPages, 2);
  assert.equal(result.auctions[0].sourceAuctionId, "CJ-EC-RJ-154503");
  assert.equal(result.auctions[0].appraisalValue, 400440.8);
  assert.equal(result.auctions[0].rawListingData.canton, "CUENCA");
});

test("CFN carousel keeps the institution represented by cod_emp", () => {
  const html = `<div id="carouselSlider:2:j_id_x"><span>Valor del Avalúo</span><span style="font-size: 35px; color:white">9,313.16</span><img src="/cfn-application-portal-remate-web/imagen?cod_emp=02&amp;image_id=448c9e43f61e4a999e295e7bc37c4916"/><div class="ui-tooltip-text">LOTE DE TERRENO SITUADO EN LA PARROQUIA PUELLARO... Enterate más</div><span>Número de Remate</span><span style="font-size: 25px; font-weight: bold; color:#FFBF00;">6245</span><span>Fecha del Remate</span><p>18<em>Agosto</em></p></div><script id="carouselSlider_s"></script>`;
  const [auction] = parseCfnCarousel(html);
  assert.equal(auction.source, "BANCO_PACIFICO");
  assert.equal(auction.sourceAuctionId, "BANCO_PACIFICO-6245");
  assert.equal(auction.appraisalValue, 9313.16);
});

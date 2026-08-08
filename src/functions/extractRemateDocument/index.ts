import { SQSEvent } from "aws-lambda";

import { dynamo } from "@libs/dynamo";
import { extractRemateDocument } from "@libs/remates/openAiExtraction";
import { normalizeAuction } from "@libs/remates/normalizer";
import { getRemateObject, rematesTableName } from "@libs/remates/store";
import { DiscoveredAuction, RemateRecord } from "@libs/remates/types";

type ExtractionMessage = {
  runId: string;
  listing: DiscoveredAuction;
  pdfS3Key: string;
  documentHash: string;
  documentFilename: string;
  downloadedAt: string;
};

export const handler = async (event: SQSEvent) => {
  for (const record of event.Records) {
    const message = JSON.parse(record.body) as ExtractionMessage;
    const tableName = rematesTableName();
    const started = Date.now();
    try {
      const existing = await dynamo.get(message.listing.sourceAuctionId, tableName) as Partial<RemateRecord> | undefined;
      if (
        existing?.documentHash === message.documentHash &&
        existing?.extractionStatus === "COMPLETE" &&
        existing?.extractorVersion === "1.0.0" &&
        existing?.promptVersion === "remates-ecuador-v1"
      ) {
        console.log(JSON.stringify({
          action: "extract_remate_document",
          itemId: message.listing.sourceAuctionId,
          status: "reused",
          duration: Date.now() - started,
        }));
        continue;
      }

      const pdf = await getRemateObject(message.pdfS3Key);
      const { extraction, model, nativeTextLength } = await extractRemateDocument(pdf, message.documentFilename);
      const normalized = normalizeAuction({
        listing: message.listing,
        extraction,
        documentHash: message.documentHash,
        pdfS3Key: message.pdfS3Key,
        documentFilename: message.documentFilename,
        downloadedAt: message.downloadedAt,
        model,
        nativeTextLength,
        existing,
      });
      await dynamo.write(normalized, tableName);
      console.log(JSON.stringify({
        action: "extract_remate_document",
        runId: message.runId,
        itemId: message.listing.sourceAuctionId,
        status: "complete",
        model,
        nativeTextLength,
        duration: Date.now() - started,
      }));
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      await dynamo.update({
        id: message.listing.sourceAuctionId,
        tableName,
        data: {
          extractionStatus: "FAILED",
          extractionError: messageText.slice(0, 500),
          lastExtractionAttemptAt: new Date().toISOString(),
        },
      });
      console.error(JSON.stringify({
        action: "extract_remate_document",
        runId: message.runId,
        itemId: message.listing.sourceAuctionId,
        status: "failed",
        error: messageText,
        duration: Date.now() - started,
      }));
      throw error;
    }
  }
};

import { beforeEach, describe, expect, it } from "bun:test";
import { S3StorageProvider } from "@meeting-bot/shared/integrations/storage/providers/S3StorageProvider";

describe("S3StorageProvider.getSignedUrl", () => {
  beforeEach(() => {
    process.env.S3_BUCKET = "test-bucket";
    process.env.S3_ACCESS_KEY = "test-access-key";
    process.env.S3_SECRET_KEY = "test-secret-key";
    process.env.S3_ENDPOINT = "http://localhost:9000";
    process.env.S3_REGION = "us-east-1";
  });

  it("omits Content-Disposition by default, so <video> can play it inline", async () => {
    const provider = new S3StorageProvider();
    const url = await provider.getSignedUrl("meetings/test.mp4");
    expect(url).not.toContain("response-content-disposition");
  });

  it("sets an attachment Content-Disposition when explicitly requested for download", async () => {
    const provider = new S3StorageProvider();
    const url = await provider.getSignedUrl("meetings/test.mp4", 3600, "attachment");
    expect(url).toContain("response-content-disposition");
    expect(decodeURIComponent(url)).toContain('attachment; filename="test.mp4"');
  });
});

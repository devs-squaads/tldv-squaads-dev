import { IStorageProvider, StorageUploadResult } from "@meeting-bot/shared/integrations/storage/types";
import fs, { createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { Readable } from "stream";

let _s3Module: typeof import("@aws-sdk/client-s3") | null = null;
let _presignerModule: typeof import("@aws-sdk/s3-request-presigner") | null = null;

async function getS3Module() {
  if (!_s3Module) _s3Module = await import("@aws-sdk/client-s3");
  return _s3Module;
}

async function getPresignerModule() {
  if (!_presignerModule) _presignerModule = await import("@aws-sdk/s3-request-presigner");
  return _presignerModule;
}

export class S3StorageProvider implements IStorageProvider {
  private client: any;
  private bucket: string;
  private endpoint?: string;
  private publicEndpoint?: string;
  private signingClient: any;
  private initialized = false;

  constructor() {
    this.bucket = process.env.S3_BUCKET || "meetings";
    this.endpoint = process.env.S3_ENDPOINT;
    this.publicEndpoint = process.env.S3_PUBLIC_ENDPOINT || this.endpoint;
  }

  private async ensureInit() {
    if (this.initialized) return;
    const { S3Client } = await getS3Module();

    this.client = new S3Client({
      region: process.env.S3_REGION || "us-east-1",
      endpoint: this.endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY || "",
        secretAccessKey: process.env.S3_SECRET_KEY || "",
      },
    });

    this.signingClient = new S3Client({
      region: process.env.S3_REGION || "us-east-1",
      endpoint: this.publicEndpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY || "",
        secretAccessKey: process.env.S3_SECRET_KEY || "",
      },
    });

    this.initialized = true;
  }

  async uploadFile(filePath: string, destinationKey: string, contentType?: string): Promise<StorageUploadResult> {
    await this.ensureInit();
    const { PutObjectCommand } = await getS3Module();

    console.log(`[S3StorageProvider] Starting upload: ${filePath} -> ${destinationKey}`);

    if (!fs.existsSync(filePath)) {
      throw new Error(`Local file not found for upload: ${filePath}`);
    }

    try {
      const fileData = fs.readFileSync(filePath);
      console.log(`[S3StorageProvider] File read complete. Size: ${fileData.length} bytes`);

      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: destinationKey,
        Body: fileData,
        ContentType: contentType || "video/mp4",
      });

      console.log(`[S3StorageProvider] Sending PutObjectCommand to ${this.endpoint || "S3"}...`);
      await this.client.send(command);
      console.log("[S3StorageProvider] Upload successful.");

      const url = this.publicEndpoint
        ? `${this.publicEndpoint}/${this.bucket}/${destinationKey}`
        : `https://${this.bucket}.s3.${process.env.S3_REGION}.amazonaws.com/${destinationKey}`;

      return { url, key: destinationKey };
    } catch (error: any) {
      console.error("[S3StorageProvider] Error during upload:", error);
      throw error;
    }
  }

  async downloadFile(key: string, localPath: string): Promise<void> {
    await this.ensureInit();
    const { GetObjectCommand } = await getS3Module();

    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    const response = await this.client.send(command);

    if (!response.Body) {
      throw new Error(`Empty response body when downloading key: ${key}`);
    }

    const writeStream = createWriteStream(localPath);
    await pipeline(response.Body as Readable, writeStream);
    console.log(`[S3StorageProvider] Downloaded ${key} to ${localPath}`);
  }

  async deleteFile(key: string): Promise<void> {
    await this.ensureInit();
    const { DeleteObjectCommand } = await getS3Module();

    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    await this.client.send(command);
  }

  async getSignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
    await this.ensureInit();
    const { GetObjectCommand } = await getS3Module();
    const { getSignedUrl } = await getPresignerModule();

    const filename = key.split("/").pop() || "recording.mp4";
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${filename}"`,
    });

    return getSignedUrl(this.signingClient, command, { expiresIn });
  }
}


import { IStorageProvider } from "@meeting-bot/shared/integrations/storage/types";
import { S3StorageProvider } from "@meeting-bot/shared/integrations/storage/providers/S3StorageProvider";

export class StorageProviderFactory {
  private static instance: IStorageProvider;

  static getProvider(): IStorageProvider {
    if (this.instance) return this.instance;

    const providerType = process.env.STORAGE_PROVIDER?.toLowerCase() || "s3";

    switch (providerType) {
      case "s3":
        this.instance = new S3StorageProvider();
        break;
      default:
        console.warn(`[StorageProviderFactory] Unknown provider ${providerType}, defaulting to S3`);
        this.instance = new S3StorageProvider();
    }

    return this.instance;
  }
}


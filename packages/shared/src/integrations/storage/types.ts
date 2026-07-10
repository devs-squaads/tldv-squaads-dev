export interface StorageUploadResult {
  url: string;
  key: string;
}

export interface IStorageProvider {
  uploadFile(filePath: string, destinationKey: string, contentType?: string): Promise<StorageUploadResult>;
  deleteFile(key: string): Promise<void>;
  downloadFile(key: string, localPath: string): Promise<void>;
  getSignedUrl(key: string, expiresIn?: number): Promise<string>;
}


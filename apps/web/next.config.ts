import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@meeting-bot/shared"],

  serverExternalPackages: [
    'puppeteer', 'puppeteer-extra', 'puppeteer-extra-plugin-stealth', 'puppeteer-stream',
    '@aws-sdk/client-s3', '@aws-sdk/s3-request-presigner',
    'pg', 'drizzle-orm', 'groq-sdk', '@google/generative-ai', 'googleapis',
  ],
};

export default nextConfig;

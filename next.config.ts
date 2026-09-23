import type { NextConfig } from "next";
import { getAllowedDevOrigins } from "./lib/config";

const nextConfig: NextConfig = {
  allowedDevOrigins: getAllowedDevOrigins(),
  output: 'standalone',
  serverExternalPackages: ['better-sqlite3'],
};

export default nextConfig;

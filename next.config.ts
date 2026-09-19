import type { NextConfig } from "next";
import { getAllowedDevOrigins } from "./lib/config";

const nextConfig: NextConfig = {
  allowedDevOrigins: getAllowedDevOrigins(),
  output: 'standalone',
};

export default nextConfig;

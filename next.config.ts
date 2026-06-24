import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["unpdf", "@napi-rs/canvas"],
};

export default nextConfig;

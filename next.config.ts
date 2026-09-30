import type { NextConfig } from "next";

const isGitHubPages = process.env.GITHUB_ACTIONS === "true";
const isStaticExport = isGitHubPages || process.env.NEXT_OUTPUT === "export";

const nextConfig: NextConfig = {
  output: isStaticExport ? "export" : "standalone",
  images: {
    unoptimized: isStaticExport,
  },
  basePath: isGitHubPages ? "/vizhufasad" : "",
  assetPrefix: isGitHubPages ? "/vizhufasad/" : "",
  trailingSlash: isGitHubPages,
  poweredByHeader: false,
};

export default nextConfig;

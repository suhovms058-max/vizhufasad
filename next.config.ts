import type { NextConfig } from "next";

const isGitHubPages = process.env.GITHUB_ACTIONS === "true";

const nextConfig: NextConfig = {
  output: isGitHubPages ? "export" : "standalone",
  basePath: isGitHubPages ? "/vizhufasad" : "",
  assetPrefix: isGitHubPages ? "/vizhufasad/" : "",
  trailingSlash: isGitHubPages,
  poweredByHeader: false,
};

export default nextConfig;

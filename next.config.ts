import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  // Do not let `next dev`/`next build` append its agent-rules block to the
  // project-owned AGENTS.md, which otherwise dirties the working tree.
  agentRules: false,
};

export default nextConfig;

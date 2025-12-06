const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Fix for multiple lockfile detection in monorepo-like structures
  outputFileTracingRoot: path.join(__dirname, './'),
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
};

module.exports = nextConfig;


/** @type {import('next').NextConfig} */
const isDevelopment = process.env.NODE_ENV !== "production";

const nextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self' https://*.auth0.com; img-src 'self' data: https://s.gravatar.com https://lh3.googleusercontent.com https://assets.coingecko.com; connect-src 'self' https://api.coingecko.com https://*.auth0.com; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""};`,
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ],
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "s.gravatar.com",
        pathname: "**",
      },
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
        pathname: "**",
      },
      {
        protocol: "https",
        hostname: "assets.coingecko.com",
        pathname: "**",
      },
    ],
  },
};

export default nextConfig;

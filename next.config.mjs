const prod = process.env.NODE_ENV === "production";
const common = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ...(prod ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
];

/** @type {import('next').NextConfig} */
const config = {
  poweredByHeader: false,
  serverExternalPackages: ["mongodb"],
  async headers() {
    return [
      { source: "/:path*", headers: common },
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] },
    ];
  },
};

export default config;

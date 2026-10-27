/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // pdfkit 依赖 Node 文件系统读取字体, 不参与打包
    serverComponentsExternalPackages: ["pdfkit"],
  },
};

export default nextConfig;

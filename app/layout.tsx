import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ML 智学平台 - 机器学习教学实验平台",
  description:
    "基于 Next.js + Supabase 的机器学习教学平台:课程管理、实验步骤引导、JupyterLab 接入、云端 GPU 分配",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

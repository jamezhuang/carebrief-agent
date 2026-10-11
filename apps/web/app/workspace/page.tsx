import type { Metadata } from "next";
import WorkspaceClient from "./WorkspaceClient";

export const metadata: Metadata = {
  title: "CareBrief · 健康咨询工作台",
  description: "个人资料、可追溯咨询与医院知识查询",
};

export default function WorkspacePage() {
  return <WorkspaceClient />;
}

import type { Metadata } from "next";
import ChatClient from "./ChatClient";

export const metadata: Metadata = {
  title: "CareBrief · 自由对话",
  description: "多轮咨询、本地资料检索与可追溯来源",
};

export default function ChatPage() {
  return <ChatClient />;
}

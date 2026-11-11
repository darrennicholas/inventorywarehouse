"use client";

import { useEffect } from "react";
import { showFeedback } from "@/components/ui/GlobalAlert";

export default function ActionFeedback({ message, tone, onDismiss, action }: { message: string; tone: "success" | "error" | "info"; onDismiss?: () => void; action?: { label: string; onClick: () => void } }) {
  useEffect(() => {
    if (message) void showFeedback(message, tone, action).then(() => onDismiss?.());
  // The alert is queued once per message/tone; a changing callback identity must not reopen it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message, tone]);
  return null;
}

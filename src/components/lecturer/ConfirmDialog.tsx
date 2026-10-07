"use client";

import React, { useEffect } from "react";
import { AlertCircle, CheckCircle2, Loader2, X } from "lucide-react";

export type ConfirmTone = "primary" | "danger" | "warning";

export interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
  isBusy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const TONE_STYLES: Record<ConfirmTone, { icon: React.ReactNode; button: string; ring: string }> = {
  primary: {
    icon: <CheckCircle2 className="h-5 w-5 text-indigo-600" />,
    button: "bg-indigo-600 hover:bg-indigo-700 text-white",
    ring: "bg-indigo-50",
  },
  danger: {
    icon: <AlertCircle className="h-5 w-5 text-rose-600" />,
    button: "bg-rose-600 hover:bg-rose-700 text-white",
    ring: "bg-rose-50",
  },
  warning: {
    icon: <AlertCircle className="h-5 w-5 text-orange-600" />,
    button: "bg-orange-600 hover:bg-orange-700 text-white",
    ring: "bg-orange-50",
  },
};

/**
 * Lightweight modal confirmation used for every irreversible Lecturer Desk
 * action (deleting a student row, submitting to the Examiner, recalling a
 * submission, approving the Examiner's marks).
 */
export function ConfirmDialog({
  isOpen,
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "primary",
  isBusy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  // Escape closes the dialog (unless an action is in flight).
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isBusy) onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, isBusy, onCancel]);

  if (!isOpen) return null;

  const styles = TONE_STYLES[tone];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-[#1a1a1a]/30 backdrop-blur-[2px]"
        onClick={() => !isBusy && onCancel()}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full max-w-md bg-white rounded-2xl premium-border shadow-2xl p-5 space-y-4"
      >
        <div className="flex items-start gap-3">
          <div className={`shrink-0 h-10 w-10 rounded-xl flex items-center justify-center ${styles.ring}`}>
            {styles.icon}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-black text-[#1a1a1a]">{title}</h3>
            <div className="text-xs text-neutral-500 leading-relaxed mt-1 space-y-2">{body}</div>
          </div>
          <button
            onClick={() => !isBusy && onCancel()}
            disabled={isBusy}
            aria-label="Close dialog"
            className="shrink-0 p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 disabled:opacity-40 cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onCancel}
            disabled={isBusy}
            className="h-9 px-4 text-xs font-bold rounded-xl bg-neutral-100 text-neutral-700 hover:bg-neutral-200 disabled:opacity-40 transition-all cursor-pointer"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={isBusy}
            className={`flex items-center gap-2 h-9 px-4 text-xs font-bold rounded-xl disabled:opacity-40 transition-all cursor-pointer ${styles.button}`}
          >
            {isBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

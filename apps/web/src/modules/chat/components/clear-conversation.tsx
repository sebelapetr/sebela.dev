"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Trash2 } from "lucide-react";

import { Button } from "@sebela/ui/components/button";

/**
 * "Clear conversation" and its confirmation: a modal dialog that says what is deleted, with
 * "Cancel" (focused first) and "Clear conversation". Nothing is deleted before the visitor
 * confirms; Escape and "Cancel" close the dialog and return focus to the button. The page behind
 * is inert while it is open.
 */
export function ClearConversation({
  disabled,
  onConfirm,
}: {
  /** Whether a clear is already under way. */
  readonly disabled: boolean;
  readonly onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const descriptionId = useId();

  function show(): void {
    const dialog = dialogRef.current;
    if (dialog === null || dialog.open) return;
    dialog.showModal();
    setOpen(true);
    cancelRef.current?.focus();
  }

  function close(): void {
    const dialog = dialogRef.current;
    if (dialog?.open === true) dialog.close();
    setOpen(false);
    triggerRef.current?.focus();
  }

  // Escape closes the dialog natively; keep the state and focus in step.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    const onCancel = (event: Event) => {
      event.preventDefault();
      close();
    };
    dialog.addEventListener("cancel", onCancel);
    return () => {
      dialog.removeEventListener("cancel", onCancel);
    };
  }, []);

  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        className="-ms-3 self-start text-muted-foreground hover:text-foreground"
        onClick={show}
      >
        <Trash2 aria-hidden="true" />
        Clear conversation
      </Button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="m-auto w-[calc(100%-2.5rem)] max-w-md rounded-xl border bg-background p-6 text-foreground backdrop:bg-background/80 open:flex open:flex-col open:gap-4"
      >
        <h2 id={titleId} className="type-item">
          Clear this conversation?
        </h2>
        <p id={descriptionId} className="text-pretty text-muted-foreground">
          Its questions and answers are deleted and the chat starts empty. An answer still being
          prepared is stopped. This cannot be undone.
        </p>
        <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
          <Button ref={cancelRef} type="button" variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => {
              close();
              onConfirm();
            }}
          >
            Clear conversation
          </Button>
        </div>
      </dialog>
    </>
  );
}

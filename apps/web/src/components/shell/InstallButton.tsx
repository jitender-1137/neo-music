"use client";
import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { promptInstall, useInstallState } from "@/lib/install";
import { Button, IconButton } from "../ui/Button";
import { CloseIcon, DownloadIcon, ShareIcon, AddSquareIconAlias } from "../icons";

/** Top-bar "Install app" — native prompt on Chromium, step-by-step sheet on iOS Safari. */
export function InstallButton({ variant = "icon" }: { variant?: "icon" | "full" }) {
  const state = useInstallState();
  const [ios, setIos] = useState(false);
  if (state.kind === "installed" || state.kind === "unavailable") return null;
  const onClick = () => (state.kind === "prompt" ? void promptInstall() : setIos(true));
  return (
    <>
      {variant === "icon"
        ? <IconButton label="Install Neo Music app" onClick={onClick}><DownloadIcon /></IconButton>
        : <Button variant="primary" icon={<DownloadIcon />} onClick={onClick}>Install app</Button>}
      <Dialog.Root open={ios} onOpenChange={setIos}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-overlay" />
          <Dialog.Content className="fixed inset-x-3 bottom-[calc(var(--safe-bottom)+12px)] z-50 rounded-2xl glass-panel p-5 sm:left-1/2 sm:right-auto sm:w-[400px] sm:-translate-x-1/2">
            <div className="mb-3 flex items-center justify-between">
              <Dialog.Title className="text-base font-semibold">Install Neo Music on your iPhone</Dialog.Title>
              <Dialog.Close asChild><IconButton label="Close" size="sm"><CloseIcon /></IconButton></Dialog.Close>
            </div>
            <Dialog.Description asChild>
              <ol className="flex flex-col gap-3 text-sm">
                <li className="flex items-center gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-semibold">1</span><span>Tap <ShareIcon className="inline h-4 w-4 align-[-2px]" /> <b>Share</b> in Safari's toolbar.</span></li>
                <li className="flex items-center gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-semibold">2</span><span>Choose <AddSquareIconAlias className="inline h-4 w-4 align-[-2px]" /> <b>Add to Home Screen</b>.</span></li>
                <li className="flex items-center gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-semibold">3</span><span>Open Neo Music from your Home Screen — music keeps playing with the screen locked.</span></li>
              </ol>
            </Dialog.Description>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

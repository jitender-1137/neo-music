"use client";
import { cloneElement, isValidElement, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { toast } from "sonner";
import type { Track } from "@zuno/core";
import { usePlayerEngine } from "@/lib/player";
import { useLibrary, useSaved } from "@/lib/library";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { track as trackEvent } from "@/lib/events";
import { markNotInterested } from "@/lib/notInterested";
import dynamic from "next/dynamic";
const AddToPlaylistDialog = dynamic(() => import("./AddToPlaylist").then((m) => m.AddToPlaylistDialog), { ssr: false });
import { albumHref, artistHref, trackHref } from "./links";
import { IconButton } from "../ui/Button";
import { Artwork } from "../ui/Artwork";
import { ActionSheet, SheetAction } from "../mobile/ActionSheet";
import { useMediaQuery, PHONE_QUERY } from "@/hooks/useMediaQuery";
import { AddToQueueIcon, DislikeIcon, HeartActiveIcon, HeartIcon, MoreVerticalIcon, PlayNextIcon, PlaylistIcon, RadioIcon, ShareIcon, VinylIcon, UserCircleIcon, TrashIcon, MusicNoteIcon } from "../icons";

export const menuItemCls = "flex cursor-pointer select-none items-center gap-3 rounded-md px-3 py-2.5 text-sm outline-none data-[highlighted]:bg-hover [&_svg]:h-5 [&_svg]:w-5 [&_svg]:text-muted";
export const menuContentCls = "z-50 min-w-[220px] rounded-2xl glass-panel p-1.5 data-[state=open]:animate-in";

export function TrackMenu({ track, extra, trigger, onRemove, removeLabel }: { track: Track; extra?: ReactNode; trigger?: ReactNode; onRemove?: () => void; removeLabel?: string }) {
  const engine = usePlayerEngine();
  const router = useRouter();
  const lib = useLibrary();
  const liked = useSaved("likes", track.id);
  const { user } = useAuth();
  const [dialog, setDialog] = useState(false);
  const [sheet, setSheet] = useState(false);
  const phone = useMediaQuery(PHONE_QUERY);
  const firstArtist = track.artists?.find((a) => a.id.startsWith("UC") || a.id.startsWith("dev-"));

  async function share() {
    const url = `${location.origin}${trackHref(track)}`;
    try {
      if (navigator.share) await navigator.share({ title: track.title, text: `${track.title} — ${track.artist}`, url });
      else { await navigator.clipboard.writeText(url); toast("Link copied"); }
    } catch { /* user cancelled share sheet */ }
  }

  async function notInterested() {
    // Works without an account: hidden on this device right away; signed-in users also tell the server.
    markNotInterested(track.id);
    if (user) await api.post("/api/v1/recommendations/feedback", { kind: "not_interested_track", targetId: track.id }).catch(() => undefined);
    void trackEvent({ type: "not_interested", trackId: track.id });
    toast("We'll show this less", { action: { label: "Undo", onClick: () => {
      markNotInterested(track.id, false);
      if (user) void api.post("/api/v1/recommendations/feedback", { kind: "not_interested_track", targetId: track.id, undo: true });
    } } });
  }

  // One list of actions, rendered as a dropdown (desktop/tablet) or an action sheet (phones).
  // `extra` holds Radix menu items, so it only appears in the dropdown.
  type Action = { key: string; icon: ReactNode; label: string; run: () => void; sep?: boolean };
  const actions: Action[] = [
    { key: "radio", icon: <RadioIcon />, label: "Start radio", run: () => engine?.startRadio(track) },
    { key: "next", icon: <PlayNextIcon />, label: "Play next", run: () => { engine?.playNext([track]); toast("Playing next"); } },
    { key: "queue", icon: <AddToQueueIcon />, label: "Add to queue", run: () => { engine?.addToQueue([track]); toast("Added to queue"); } },
    { key: "like", sep: true, icon: liked ? <HeartActiveIcon className="!text-accent" /> : <HeartIcon />, label: liked ? "Remove from Liked music" : "Add to Liked music", run: () => void lib.toggle("likes", track) },
    { key: "save", icon: <PlaylistIcon />, label: "Save to playlist", run: () => setDialog(true) },
    ...(onRemove ? [{ key: "remove", icon: <TrashIcon />, label: removeLabel ?? "Remove", run: onRemove }] : []),
    { key: "details", sep: true, icon: <MusicNoteIcon />, label: "Song details", run: () => router.push(trackHref(track)) },
    ...(track.albumId ? [{ key: "album", icon: <VinylIcon />, label: "Go to album", run: () => router.push(albumHref({ id: track.albumId! })) }] : []),
    ...(firstArtist ? [{ key: "artist", icon: <UserCircleIcon />, label: "Go to artist", run: () => router.push(artistHref(firstArtist)) }] : []),
    { key: "share", icon: <ShareIcon />, label: "Share", run: () => void share() },
    { key: "dislike", icon: <DislikeIcon />, label: "Not interested", run: () => void notInterested() },
  ];

  const defaultTrigger = <IconButton label={`More actions for ${track.title}`} size="sm" onClick={(e) => e.stopPropagation()}><MoreVerticalIcon /></IconButton>;

  return (
    <>
      {phone ? (
        <>
          {(() => {
            const t = trigger ?? defaultTrigger;
            const open = (e: React.MouseEvent) => { e.stopPropagation(); setSheet(true); };
            return isValidElement<{ onClick?: (e: React.MouseEvent) => void }>(t) ? cloneElement(t, { onClick: open }) : t;
          })()}
          <ActionSheet open={sheet} onOpenChange={setSheet} title={`Actions for ${track.title}`}
            header={<div className="flex items-center gap-3"><Artwork src={track.artworkUrl} alt="" size={48} className="w-12" /><div className="min-w-0"><div className="line-clamp-1 font-semibold">{track.title}</div><div className="line-clamp-1 text-sm text-muted">{track.artist}</div></div></div>}>
            {actions.map((a) => (
              <div key={a.key}>
                {a.sep && <div className="mx-3 my-1 h-px bg-divider" />}
                {/* Close first so the sheet never lingers over a page we navigate to. */}
                <SheetAction icon={a.icon} onSelect={() => { setSheet(false); a.run(); }}>{a.label}</SheetAction>
              </div>
            ))}
          </ActionSheet>
        </>
      ) : (
        <Menu.Root modal={false}>
          <Menu.Trigger asChild>{trigger ?? defaultTrigger}</Menu.Trigger>
          <Menu.Portal>
            <Menu.Content className={menuContentCls} align="end" sideOffset={4} collisionPadding={12} onClick={(e) => e.stopPropagation()}>
              {actions.map((a) => (
                <div key={a.key}>
                  {a.sep && <Menu.Separator className="my-1 h-px bg-divider" />}
                  <Menu.Item className={menuItemCls} onSelect={a.run}>{a.icon}{a.label}</Menu.Item>
                </div>
              ))}
              {extra}
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
      )}
      {dialog && <AddToPlaylistDialog tracks={[track]} open={dialog} onOpenChange={setDialog} />}
    </>
  );
}

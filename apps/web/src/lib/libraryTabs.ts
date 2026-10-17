/** Shared by the server route (validation) and the client view — must not live in a "use client" file. */
export const LIBRARY_TABS = [
  { id: "playlists", label: "Playlists" },
  { id: "liked", label: "Liked music" },
  { id: "albums", label: "Albums" },
  { id: "artists", label: "Artists" },
] as const;
export type LibraryTab = (typeof LIBRARY_TABS)[number]["id"];

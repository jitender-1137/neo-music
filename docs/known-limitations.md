# Known limitations

1. **Not a licensed catalog.** The YouTube provider uses an unofficial API (see
   music-licensing.md). It can break without notice and is unsuitable for public deployment.
2. **No real-device iOS/Android verification yet.** Background audio, lock-screen controls and
   interruptions are implemented per platform guidance but unverified on hardware.
3. **Audio is proxied through the API** (required for YouTube). Bandwidth scales with listeners;
   plan capacity (~160 MB/s per instance measured locally) and egress costs.
4. **Recommendation quality is unmeasured** — the evaluation harness needs ≥500 real qualified
   listens from ≥20 users. Weights are starting values.
5. **No email verification / password reset by email** (no mail provider configured). Accounts
   can change password when signed in; a reset flow needs an SMTP/transactional mail service.
6. **No offline downloads** (would need licensed offline rights) and **no premium tier**.
7. **Gapless/crossfade not implemented** in the web player (single media element; Zuno's Rust
   engine had it). Preloading is limited to warming the next track's server-side resolution.
8. **Mobile LCP is at the 2.5 s budget**, not comfortably under it, on a throttled profile.
9. **Search typo-tolerance** comes from the provider; we don't run our own index.
10. **Guest data on iOS Safari can be evicted** after ~7 days of non-use (browser policy).
11. **Horizontal scaling**: stateless by design (pagination tokens, Redis, Postgres); the
    PoToken minter is per-process — each API instance attests on its own (≈1 s once per 12 h).
12. Generated mixes ("<Artist> Mix") are provider radio playlists, not our own model's output.

"use client";

/** Neo Music mark: the headphone ghost mascot (source art: docs/brand/neo-ghost-source.png). */
export function Logo({ className, withWord = true }: { className?: string; withWord?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- tiny static PNG, no optimisation needed */}
      {/* Phones get a bigger mark and title (app-like header); desktop keeps 32px / text-lg. */}
      <img src="/icons/ghost-128.png" alt="" width={40} height={40} className="h-10 w-10 shrink-0 md:h-8 md:w-8" />
      {withWord && (
        <span className="text-[22px] font-bold tracking-tight md:text-lg">
          Neo <span className="bg-gradient-to-r from-[#d9602a] to-[#ee8a4f] bg-clip-text dark:from-[#f39a62] dark:to-[#ffc39a] font-semibold text-transparent">Music</span>
        </span>
      )}
    </span>
  );
}

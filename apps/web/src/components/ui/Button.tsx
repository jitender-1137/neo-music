"use client";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "outline" | "danger";
const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg shadow-[0_6px_20px_-8px_var(--color-accent)] hover:bg-accent-strong",
  secondary: "glass text-foreground hover:glass-strong",
  ghost: "bg-transparent text-foreground hover:bg-hover",
  outline: "glass text-foreground hover:glass-strong",
  danger: "bg-danger text-white hover:opacity-90",
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg"; icon?: ReactNode; loading?: boolean }>(
  function Button({ variant = "secondary", size = "md", icon, loading, className, children, disabled, ...rest }, ref) {
    // Same small height for all text buttons; size only changes horizontal padding.
    const sizes = { sm: "h-8 px-3 text-xs gap-1.5", md: "h-9 px-4 text-sm gap-1.5", lg: "h-9 px-5 text-sm gap-1.5" };
    return (
      <button
        ref={ref}
        className={cn("inline-flex select-none items-center justify-center rounded-full font-medium [&_svg]:h-4 [&_svg]:w-4 transition-[background,opacity,transform] duration-[var(--duration-fast)] active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50", variants[variant], sizes[size], className)}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...rest}
      >
        {loading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden /> : icon}
        {children}
      </button>
    );
  },
);

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string; size?: "sm" | "md" | "lg" | "xl"; active?: boolean }>(
  function IconButton({ label, size = "md", active, className, children, ...rest }, ref) {
    // One small scale everywhere (sm 32px / md+lg 36px with 18–20px glyphs; xl only for the main play button).
    const sizes = { sm: "h-8 w-8 [&_svg]:h-[18px] [&_svg]:w-[18px]", md: "h-9 w-9 [&_svg]:h-5 [&_svg]:w-5", lg: "h-9 w-9 [&_svg]:h-5 [&_svg]:w-5", xl: "h-11 w-11 [&_svg]:h-[22px] [&_svg]:w-[22px]" };
    return (
      <button
        ref={ref}
        type="button"
        aria-label={label}
        title={label}
        className={cn("inline-grid shrink-0 place-items-center rounded-full text-foreground transition-[background,color,transform] duration-[var(--duration-fast)] hover:bg-hover active:scale-90 disabled:pointer-events-none disabled:opacity-40", sizes[size], active && "text-accent", className)}
        {...rest}
      >
        {children}
      </button>
    );
  },
);

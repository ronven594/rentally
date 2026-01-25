import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline:
          "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost:
          "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",
        // Brand variants - Neon-Dark Theme (Glass/Transparent styles)
        brand:
          "bg-white/5 text-white font-black uppercase tracking-widest border border-white/10 backdrop-blur-sm hover:bg-white/10 hover:border-white/20 hover:shadow-[0_0_15px_rgba(255,255,255,0.1)] active:scale-95 transition-all",
        "brand-success":
          "bg-[#00FFBB]/10 border border-[#00FFBB]/30 text-[#00FFBB] font-black uppercase tracking-widest hover:bg-[#00FFBB]/20 hover:shadow-[0_0_15px_rgba(0,255,187,0.3)] backdrop-blur-sm transition-all",
        "brand-secondary":
          "bg-white/5 border border-white/10 text-white/70 font-bold uppercase tracking-widest hover:bg-white/10 hover:border-white/20 hover:text-white backdrop-blur-sm transition-all",
        "brand-danger":
          "bg-[#FF3B3B]/10 border border-[#FF3B3B]/30 text-[#FF3B3B] font-black uppercase tracking-widest hover:bg-[#FF3B3B]/20 hover:shadow-[0_0_15px_rgba(255,59,59,0.4)] backdrop-blur-sm active:scale-95 transition-all",
        "brand-warning":
          "bg-[#FFB800]/10 border border-[#FFB800]/30 text-[#FFB800] font-black uppercase tracking-widest hover:bg-[#FFB800]/20 hover:shadow-[0_0_15px_rgba(255,184,0,0.4)] backdrop-blur-sm active:scale-95 transition-all",
        // Accent button for primary actions (Save, Submit, etc.) - Glassmorphism style
        "brand-accent":
          "bg-[#00FFBB]/15 border border-[#00FFBB]/40 text-[#00FFBB] font-black uppercase tracking-widest backdrop-blur-sm hover:bg-[#00FFBB]/25 hover:border-[#00FFBB]/60 hover:shadow-[0_0_20px_rgba(0,255,187,0.3)] active:scale-95 transition-all",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
        // Brand size - tall pill buttons (synced with btn-black utility)
        brand: "py-4 px-6 text-[11px] font-black uppercase tracking-widest rounded-full",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }

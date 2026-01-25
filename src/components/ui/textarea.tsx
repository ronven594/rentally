import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        // Neon-Dark Textarea Base
        "flex field-sizing-content min-h-24 w-full rounded-xl px-4 py-3 text-sm font-medium transition-all outline-none resize-none",
        // Glass styling
        "bg-white/5 border border-white/10 text-white placeholder:text-white/30",
        // Focus state with Neon Mint glow
        "focus:border-[#00FFBB]/50 focus:ring-2 focus:ring-[#00FFBB]/20 focus:bg-white/[0.07]",
        // Disabled state
        "disabled:cursor-not-allowed disabled:opacity-50",
        // Invalid state with Electric Red
        "aria-invalid:border-[#FF3B3B]/50 aria-invalid:ring-[#FF3B3B]/20",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }

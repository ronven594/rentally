import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // Neon-Dark Input Base
        "h-11 w-full min-w-0 rounded-xl px-4 py-2 text-sm font-medium transition-all outline-none",
        // Glass styling
        "bg-white/5 border border-white/10 text-white placeholder:text-white/30",
        // Focus state with Neon Mint glow
        "focus:border-[#00FFBB]/50 focus:ring-2 focus:ring-[#00FFBB]/20 focus:bg-white/[0.07]",
        // Disabled state
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        // File input styling
        "file:text-white file:inline-flex file:h-7 file:border-0 file:bg-white/10 file:rounded-lg file:px-3 file:text-sm file:font-medium file:mr-3",
        // Invalid state with Electric Red
        "aria-invalid:border-[#FF3B3B]/50 aria-invalid:ring-[#FF3B3B]/20",
        className
      )}
      {...props}
    />
  )
}

export { Input }

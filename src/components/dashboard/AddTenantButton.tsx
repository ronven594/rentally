"use client"

import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"

interface AddTenantButtonProps {
    onClick: () => void;
}

export function AddTenantButton({ onClick }: AddTenantButtonProps) {
    return (
        <Button
            onClick={onClick}
            size="icon"
            className="fixed bottom-8 right-8 h-16 w-16 rounded-full shadow-neu hover:shadow-neu-pressed bg-primary text-primary-foreground transition-all duration-300 z-50"
        >
            <Plus className="h-8 w-8" />
            <span className="sr-only">Add Tenant</span>
        </Button>
    )
}

"use client"

import { MobileNav } from "./MobileNav"
import { DesktopNav } from "./DesktopNav"

export function Navigation() {
    return (
        <>
            <DesktopNav />
            <MobileNav />
        </>
    )
}

"use client"

import { useEffect } from "react"

export function StorageCleanup() {
    useEffect(() => {
        // One-time cleanup for legacy mock data
        const version = localStorage.getItem("app_version");
        if (version !== "2.0") {
            localStorage.removeItem("landlord_expenses");
            localStorage.setItem("app_version", "2.0");
            console.log("Legacy mock data cleared.");
        }
    }, []);

    return null;
}

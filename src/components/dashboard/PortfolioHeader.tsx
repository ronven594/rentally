import { cn } from "@/lib/utils"

interface PortfolioHeaderProps {
    userName?: string;
    isHealthy?: boolean;
    className?: string;
}

export function PortfolioHeader({ userName = "Landlord", isHealthy = true, className }: PortfolioHeaderProps) {
    return (
        <header className={cn("py-8 px-1", className)}>
            <h1 className="text-3xl font-black tracking-tight text-nav-black italic">
                Portfolio
            </h1>
            {isHealthy && (
                <p className="text-sm font-bold text-gray-400 mt-1">
                    Everything's Ship-Shape.
                </p>
            )}
        </header>
    )
}

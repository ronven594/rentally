import { Badge } from "@/components/ui/badge";

interface StrikeBadgeProps {
    strikes: number;
}

export function StrikeBadge({ strikes }: StrikeBadgeProps) {
    if (strikes === 0) {
        return (
            <Badge variant="outline" className="bg-green-100 text-green-800 border-green-200 hover:bg-green-100">
                0 Strikes - Good Standing
            </Badge>
        );
    }

    if (strikes < 3) {
        return (
            <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 border-yellow-200 hover:bg-yellow-100">
                {strikes} Strike{strikes > 1 ? "s" : ""} - Monitor
            </Badge>
        );
    }

    return (
        <Badge variant="destructive" className="bg-red-100 text-red-800 border-red-200 hover:bg-red-100">
            {strikes} Strikes - Action Required
        </Badge>
    );
}

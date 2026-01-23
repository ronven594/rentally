"use client"

import { useState, DragEvent } from "react"
import { UploadCloud, FileCheck } from "lucide-react"
import { cn } from "@/lib/utils"

interface DropZoneProps {
    onFilesDropped: (files: File[]) => void;
}

export function DropZone({ onFilesDropped }: DropZoneProps) {
    const [isDragOver, setIsDragOver] = useState(false);

    const handleDragOver = (e: DragEvent) => {
        e.preventDefault();
        setIsDragOver(true);
    };

    const handleDragLeave = (e: DragEvent) => {
        e.preventDefault();
        setIsDragOver(false);
    };

    const handleDrop = (e: DragEvent) => {
        e.preventDefault();
        setIsDragOver(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            onFilesDropped(Array.from(e.dataTransfer.files));
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            onFilesDropped(Array.from(e.target.files));
        }
    };

    const handleClick = () => {
        document.getElementById('receipt-file-input')?.click();
    };

    return (
        <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={handleClick}
            className={cn(
                "h-64 w-full rounded-2xl border-2 border-dashed flex flex-col items-center justify-center transition-all cursor-pointer",
                isDragOver
                    ? "border-emerald-400 bg-emerald-50/50 scale-[1.01]"
                    : "border-slate-200 bg-white hover:border-emerald-200 hover:bg-slate-50"
            )}
        >
            <input
                id="receipt-file-input"
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                onChange={handleFileChange}
                className="hidden"
            />
            <div className={cn(
                "p-4 rounded-full mb-4 transition-colors",
                isDragOver ? "bg-emerald-100 text-emerald-600" : "bg-slate-100 text-slate-400"
            )}>
                {isDragOver ? <FileCheck className="w-8 h-8" /> : <UploadCloud className="w-8 h-8" />}
            </div>
            <h3 className="text-lg font-bold text-slate-800">Tap to Scan / Drop Receipts</h3>
            <p className="text-sm text-slate-400 mt-2 text-center max-w-[200px]">
                Drop PDF or Images to instantly categorize.
            </p>
        </div>
    )
}

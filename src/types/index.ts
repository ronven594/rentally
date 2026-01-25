export type PaymentStatus = "Paid" | "Late" | "Unpaid" | "Pending" | "Partial";

export type PaymentFrequency = "Weekly" | "Fortnightly" | "Monthly";

export interface StrikeNotice {
    id: string;
    type: 'STRIKE_1' | 'STRIKE_2' | 'STRIKE_3' | 'REMEDY_NOTICE';
    sentAt: string; // ISO date string (YYYY-MM-DD)
    officialServiceDate: string; // ISO date string - when notice was officially served
}

export interface PaymentHistoryEntry {
    id: string;
    amount: number;
    date: string; // ISO date string (YYYY-MM-DD)
    method: 'Bank Transfer' | 'Cash' | 'Other';
    timestamp: string; // ISO timestamp when payment was recorded
}

export interface Tenant {
    id: string;
    name: string;
    email: string;
    phone?: string;
    rentAmount: number;
    frequency: PaymentFrequency;
    rentDueDay: string; // e.g. "Wednesday" for weekly/fortnightly, or "1" for monthly (day of month)
    startDate?: string; // Lease start date (when tenant moved in)
    trackingStartDate?: string; // When we started tracking this tenant in the app (YYYY-MM-DD)
    openingArrears?: number; // Any existing debt when we started tracking (defaults to 0)
    sentNotices?: StrikeNotice[]; // 90-day rolling strike history
    remedyNoticeSentAt?: string; // ISO date string (YYYY-MM-DD) - 14-day notice to remedy
    paymentHistory?: PaymentHistoryEntry[]; // Record of all payments received
    weekly_rent?: number;
    tenant_address?: string;
    region?: "Wellington" | "Auckland" | "Nelson" | "Taranaki" | "Otago" | "Southland" | "Hawke's Bay" | "Canterbury";
    createdAt?: string;
}

export interface Property {
    id: string;
    name: string;
    address: string;
    type?: string;
    yearBuilt?: number;
    region: "Wellington" | "Auckland" | "Nelson" | "Taranaki" | "Otago" | "Southland" | "Hawke's Bay" | "Canterbury";
    tenants: Tenant[];
}

export type ExpenseStatus = "Verified" | "Processing" | "Incomplete Info" | "Missing GST";

export interface Expense {
    id: string;
    date: string;
    merchant?: string; // Optional to support incomplete state
    amount: number;
    gst?: number; // GST component
    category: "Rates" | "Insurance" | "Maintenance" | "Interest" | "Management Fees" | "Legal Fees" | "Other";
    receiptUrl?: string; // For eventually showing the image
    status: ExpenseStatus;
}

export interface RentPayment {
    id: string;
    tenantId: string;
    dueDate: string;
    paidDate?: string;
    amount: number;
    amount_paid?: number; // Track partial payments
    status: PaymentStatus;
    notes?: string;
}

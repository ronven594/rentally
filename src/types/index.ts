export type PaymentStatus = "Paid" | "Late" | "Unpaid" | "Pending" | "Partial";

export interface Tenant {
    id: string;
    name: string;
    email: string;
    phone?: string;
    rentAmount: number;
    frequency: "Weekly" | "Fortnightly";
    rentDueDay: string; // e.g. "Wednesday"
    startDate?: string;
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

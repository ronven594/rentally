import { supabase } from '../lib/supabaseClient';

export const EVENT_TYPES = {
    RENT_MISSED: 'RENT_MISSED',
    RENT_PARTIAL: 'RENT_PARTIAL',
    RENT_PAID: 'RENT_PAID',
    STRIKE_ISSUED: 'STRIKE_ISSUED',
    STRIKE_CLEARED: 'STRIKE_CLEARED',
    NOTICE_GENERATED: 'NOTICE_GENERATED',
    NOTICE_SENT: 'NOTICE_SENT',
    PAYMENT_PLAN_AGREED: 'PAYMENT_PLAN_AGREED',
    TAX_RECEIPT_UPLOADED: 'TAX_RECEIPT_UPLOADED',
    TAX_DEDUCTION_FLAGGED: 'TAX_DEDUCTION_FLAGGED',
    TAX_REPORT_EXPORTED: 'TAX_REPORT_EXPORTED',
    HH_INSPECTION: 'HH_INSPECTION',
    HH_UPGRADE_COMPLETED: 'HH_UPGRADE_COMPLETED',
    HH_ISSUE_DETECTED: 'HH_ISSUE_DETECTED',
    HH_COMPLIANCE_MET: 'HH_COMPLIANCE_MET',
    MANUAL_NOTE: 'MANUAL_NOTE',
    MAINTENANCE_REQUEST: 'MAINTENANCE_REQUEST',
    PROPERTY_INSPECTION: 'PROPERTY_INSPECTION',
    PHOTO_UPLOADED: 'PHOTO_UPLOADED',
    ADMIN_ADJUSTMENT: 'ADMIN_ADJUSTMENT',
} as const;

export const CATEGORIES = {
    ARREARS: 'ARREARS',
    TAX: 'TAX',
    HEALTHY_HOMES: 'HEALTHY_HOMES',
    MAINTENANCE: 'MAINTENANCE',
    GENERAL: 'GENERAL',
    PAYMENT: 'PAYMENT',
} as const;

export type EventType = typeof EVENT_TYPES[keyof typeof EVENT_TYPES];
export type Category = typeof CATEGORIES[keyof typeof CATEGORIES];

export interface EvidenceLedgerEntry {
    id: string;
    created_at: string;
    property_id: string;
    tenant_id: string | null;
    event_type: EventType;
    category: Category;
    title: string;
    description: string | null;
    metadata: Record<string, any>;
    file_urls: string[];
    source_table: string | null;
    source_id: string | null;
    is_redacted: boolean;
}

/**
 * Logs an event to the evidence_ledger table.
 */
export async function logToEvidenceLedger(
    propertyId: string,
    tenantId: string | null,
    eventType: EventType,
    category: Category,
    title: string,
    description: string | null = null,
    metadata: Record<string, any> = {},
    fileUrls: string[] = [],
    sourceTable: string | null = null,
    sourceId: string | null = null
): Promise<EvidenceLedgerEntry | null> {
    try {
        const { data, error } = await supabase
            .from('evidence_ledger')
            .insert({
                property_id: propertyId,
                tenant_id: tenantId,
                event_type: eventType,
                category: category,
                title: title,
                description: description,
                metadata: metadata,
                file_urls: fileUrls,
                source_table: sourceTable,
                source_id: sourceId,
            })
            .select()
            .single();

        if (error) {
            console.error('Error logging to evidence ledger:', error.message);
            return null;
        }

        return data as EvidenceLedgerEntry;
    } catch (err) {
        console.error('Unexpected error in logToEvidenceLedger:', err);
        return null;
    }
}

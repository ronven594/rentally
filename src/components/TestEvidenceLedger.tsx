import React from 'react';
import { logToEvidenceLedger, EVENT_TYPES, CATEGORIES } from '../services/evidenceLedger';

export function TestEvidenceLedger() {
    const handleTestLog = async () => {
        // Replace with a valid property UUID from your database
        const propertyId = 'a1b2c3d4-e5f6-7a8b-9c0d-e1f2a3b4c5d6';

        const result = await logToEvidenceLedger(
            propertyId,
            null,
            EVENT_TYPES.MANUAL_NOTE,
            CATEGORIES.GENERAL,
            'Test Entry',
            'Manually triggered test log'
        );

        if (result) {
            alert("Success! Entry logged to Supabase.");
        } else {
            alert("Failed to log. See console for error.");
        }
    };

    return (
        <button
            onClick={handleTestLog}
            className="px-6 py-3 bg-emerald-600 text-white font-bold rounded-xl shadow-lg hover:bg-emerald-700 transition-all active:scale-95"
        >
            Test Evidence Ledger
        </button>
    );
}

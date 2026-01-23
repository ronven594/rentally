import React from 'react';
import { logToEvidenceLedger, EVENT_TYPES, CATEGORIES } from '../services/evidenceLedger';

export default function TestEvidenceLedger() {
    const handleTestLog = async () => {
        // Extracting just the UUID from the provided test data string
        const propertyId = 'a1b2c3d4-e5f6-7a8b-9c0d-e1f2a3b4c5d6';

        const result = await logToEvidenceLedger(
            propertyId,
            null,
            EVENT_TYPES.MANUAL_NOTE,
            CATEGORIES.GENERAL,
            'Test Entry',
            'Test at ' + new Date()
        );

        if (result) {
            alert("Success! Evidence logged to ledger.");
        } else {
            alert("Failed to log evidence. Check console.");
        }
    };

    return (
        <button
            onClick={handleTestLog}
            style={{
                padding: '10px 20px',
                backgroundColor: '#0f172a',
                color: 'white',
                borderRadius: '12px',
                border: 'none',
                cursor: 'pointer',
                fontWeight: 'bold'
            }}
        >
            Test Evidence Ledger
        </button>
    );
}

// Test script to verify tenant update flow
// Run this to see what's being sent to Supabase

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

async function testTenantUpdate() {
    console.log('=== TENANT UPDATE DEBUG TEST ===\n')

    // 1. Check schema
    console.log('1. Checking tenants table schema...')
    const { data: schemaData, error: schemaError } = await supabase
        .from('tenants')
        .select('*')
        .limit(1)

    if (schemaData && schemaData.length > 0) {
        console.log('Available columns:', Object.keys(schemaData[0]))
    }

    // 2. Simulate the update from ManageTenantDialog
    const mockUpdates = {
        name: 'Test Tenant',
        email: 'test@example.com',
        phone: '021234567',
        rentAmount: 500,
        frequency: 'Weekly',
        rentDueDay: 'Wednesday',
        tenant_address: '123 Test St',
        startDate: '2026-01-01',
        leaseEndDate: '2027-01-01'
    }

    console.log('\n2. Mock updates from ManageTenantDialog:')
    console.log(JSON.stringify(mockUpdates, null, 2))

    // 3. Simulate handleUpdateTenant mapping
    const dbUpdates: any = {}

    if (mockUpdates.name) {
        const parts = mockUpdates.name.trim().split(' ')
        dbUpdates.first_name = parts[0] || ''
        dbUpdates.last_name = parts.slice(1).join(' ') || ''
    }
    if (mockUpdates.email !== undefined) dbUpdates.email = mockUpdates.email
    if (mockUpdates.phone !== undefined) dbUpdates.phone = mockUpdates.phone
    if (mockUpdates.rentAmount !== undefined) dbUpdates.weekly_rent = mockUpdates.rentAmount
    if (mockUpdates.tenant_address !== undefined) dbUpdates.tenant_address = mockUpdates.tenant_address
    if (mockUpdates.startDate !== undefined) dbUpdates.lease_start_date = mockUpdates.startDate
    if (mockUpdates.leaseEndDate !== undefined) dbUpdates.lease_end_date = mockUpdates.leaseEndDate

    // THE CRITICAL LINES
    if (mockUpdates.frequency !== undefined) (dbUpdates as any).rent_frequency = mockUpdates.frequency
    if (mockUpdates.rentDueDay !== undefined) (dbUpdates as any).rent_due_day = mockUpdates.rentDueDay

    console.log('\n3. Mapped dbUpdates object (what gets sent to Supabase):')
    console.log(JSON.stringify(dbUpdates, null, 2))

    console.log('\n4. Checking if rent_frequency and rent_due_day are in dbUpdates:')
    console.log('  rent_frequency:', dbUpdates.rent_frequency)
    console.log('  rent_due_day:', dbUpdates.rent_due_day)

    console.log('\n=== END TEST ===')
}

testTenantUpdate()

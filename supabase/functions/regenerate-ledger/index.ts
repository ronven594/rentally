/**
 * Supabase Edge Function: Regenerate Ledger
 *
 * Automatically regenerates the payment ledger when tenant settings change.
 * This ensures the ledger stays in sync server-side, even if client-side sync fails.
 *
 * Triggered by: Database trigger on tenants table UPDATE
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Import the regeneration logic
// NOTE: In production, you'd need to share this code or reimplement it
async function regeneratePaymentLedger(
  tenantId: string,
  newSettings: any,
  supabaseClient: any,
  currentDate: Date = new Date()
) {
  console.log('🔄 LEDGER REGENERATOR - Starting ledger regeneration:', {
    tenantId,
    newSettings,
    currentDate: currentDate.toISOString()
  });

  try {
    // Fetch current payments to calculate balance
    const { data: currentPayments, error: fetchError } = await supabaseClient
      .from('payments')
      .select('*')
      .eq('tenant_id', tenantId)
      .gte('due_date', newSettings.trackingStartDate);

    if (fetchError) throw fetchError;

    // Calculate current balance
    const currentBalance = currentPayments
      .filter((p: any) => p.status === 'Unpaid' || p.status === 'Partial')
      .reduce((sum: number, p: any) => sum + (p.amount - p.amount_paid), 0);

    console.log('💰 Current balance:', currentBalance);

    // Delete existing payments
    const { error: deleteError } = await supabaseClient
      .from('payments')
      .delete()
      .eq('tenant_id', tenantId)
      .gte('due_date', newSettings.trackingStartDate);

    if (deleteError) throw deleteError;

    console.log('🗑️ Deleted existing payment records');

    // Generate new payment dates
    const allDueDates = generatePaymentDates(
      newSettings.trackingStartDate,
      newSettings.frequency,
      newSettings.rentDueDay,
      currentDate
    );

    // Create new payment records
    const allPaymentRecords = allDueDates.map((dueDate: Date) => ({
      tenant_id: tenantId,
      property_id: newSettings.propertyId,
      due_date: dueDate.toISOString().split('T')[0],
      amount: newSettings.rentAmount,
      status: 'Unpaid',
      amount_paid: 0,
      paid_date: null
    }));

    const { data: insertedPayments, error: insertError } = await supabaseClient
      .from('payments')
      .insert(allPaymentRecords)
      .select();

    if (insertError) throw insertError;

    console.log('✅ Created new payment records:', insertedPayments.length);

    // If there's a balance, redistribute it
    if (currentBalance > 0 && insertedPayments && insertedPayments.length > 0) {
      await redistributeBalance(
        insertedPayments,
        currentBalance,
        newSettings.rentAmount,
        supabaseClient
      );
    }

    return {
      success: true,
      recordsCreated: insertedPayments.length,
      balanceRedistributed: currentBalance
    };
  } catch (error: any) {
    console.error('❌ Ledger regeneration failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

function generatePaymentDates(
  trackingStartDate: string,
  frequency: string,
  rentDueDay: string,
  currentDate: Date
): Date[] {
  const allDueDates: Date[] = [];
  const trackingStart = new Date(trackingStartDate);
  let currentDueDate = new Date(trackingStart);

  // Simplified generation (you'd use the full logic from ledger-regenerator.ts)
  const daysIncrement = frequency === 'Weekly' ? 7 : frequency === 'Fortnightly' ? 14 : 30;

  const maxIterations = 520;
  let iterations = 0;

  while (currentDueDate <= currentDate && iterations < maxIterations) {
    allDueDates.push(new Date(currentDueDate));
    iterations++;

    currentDueDate = new Date(currentDueDate.getTime() + daysIncrement * 24 * 60 * 60 * 1000);
  }

  return allDueDates;
}

async function redistributeBalance(
  payments: any[],
  balance: number,
  rentAmount: number,
  supabaseClient: any
) {
  // Sort payments by due date (oldest first)
  const sortedPayments = [...payments].sort((a, b) =>
    a.due_date.localeCompare(b.due_date)
  );

  // Work backwards to find unpaid records
  const unpaidRecords: string[] = [];
  const paidRecords: string[] = [];
  let remainingDebt = balance;

  for (let i = sortedPayments.length - 1; i >= 0; i--) {
    const payment = sortedPayments[i];

    if (remainingDebt <= 0) {
      paidRecords.push(payment.id);
    } else {
      unpaidRecords.push(payment.id);
      remainingDebt -= payment.amount;
    }
  }

  // Mark records as Paid
  if (paidRecords.length > 0) {
    const { data: recordsToPay } = await supabaseClient
      .from('payments')
      .select('id, amount')
      .in('id', paidRecords);

    if (recordsToPay) {
      for (const record of recordsToPay) {
        await supabaseClient
          .from('payments')
          .update({
            status: 'Paid',
            amount_paid: record.amount,
            paid_date: new Date().toISOString().split('T')[0]
          })
          .eq('id', record.id);
      }
    }
  }

  // Mark records as Unpaid
  if (unpaidRecords.length > 0) {
    await supabaseClient
      .from('payments')
      .update({
        status: 'Unpaid',
        amount_paid: 0,
        paid_date: null
      })
      .in('id', unpaidRecords);
  }

  console.log('✅ Balance redistributed:', {
    paidRecords: paidRecords.length,
    unpaidRecords: unpaidRecords.length
  });
}

serve(async (req) => {
  try {
    const { record } = await req.json();

    console.log('📨 Received tenant update webhook:', record);

    // Create Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Regenerate ledger
    const result = await regeneratePaymentLedger(
      record.id,
      {
        trackingStartDate: record.tracking_start_date,
        rentAmount: record.weekly_rent,
        frequency: record.rent_frequency,
        rentDueDay: record.rent_due_day,
        propertyId: record.property_id
      },
      supabaseClient
    );

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});

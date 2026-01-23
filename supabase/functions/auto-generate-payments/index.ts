import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'
import { addDays, format, getDay, isAfter, isBefore, parseISO } from 'https://esm.sh/date-fns@2.30.0'

// CORS headers for local testing
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ------------------------------------------------------------------
// DATE UTILITIES (Ported from client-side)
// ------------------------------------------------------------------

const DAY_OF_WEEK_MAP: Record<string, number> = {
    "Sunday": 0,
    "Monday": 1,
    "Tuesday": 2,
    "Wednesday": 3,
    "Thursday": 4,
    "Friday": 5,
    "Saturday": 6
};

function findNextDueDay(startDate: Date, targetDayName: string): Date {
    const targetDay = DAY_OF_WEEK_MAP[targetDayName];
    if (targetDay === undefined) throw new Error(`Invalid day name: ${targetDayName}`);

    const currentDay = getDay(startDate);

    // Calculate days to add using modulo
    let daysToAdd = (targetDay - currentDay + 7) % 7;

    return addDays(startDate, daysToAdd);
}

function calculateDueDates(
    leaseStartDate: string,
    frequency: "Weekly" | "Fortnightly",
    rentDueDay: string,
    today: Date = new Date(),
    generationStartDate?: Date
): string[] {
    const dueDates: string[] = [];
    const leaseStart = parseISO(leaseStartDate);

    let currentDueDate = findNextDueDay(leaseStart, rentDueDay);

    // If first due day is before lease start, use lease start
    if (isBefore(currentDueDate, leaseStart)) {
        currentDueDate = leaseStart;
    }

    const intervalDays = frequency === "Weekly" ? 7 : 14;

    // Generate due dates up to and INCLUDING next upcoming
    const todayObj = today instanceof Date ? today : new Date(today);
    const todayTime = new Date(todayObj.getFullYear(), todayObj.getMonth(), todayObj.getDate()).getTime();

    let iterations = 0;
    while (iterations < 100) {
        iterations++;

        // Only add if it's on or after the generationStartDate (if provided)
        const isAfterStart = !generationStartDate ||
            isAfter(currentDueDate, generationStartDate) ||
            currentDueDate.toDateString() === generationStartDate.toDateString();

        if (isAfterStart) {
            dueDates.push(format(currentDueDate, "yyyy-MM-dd"));
        }

        // Stop if we have at least one valid date and we've reached TODAY or FUTURE
        const currentTime = new Date(currentDueDate.getFullYear(), currentDueDate.getMonth(), currentDueDate.getDate()).getTime();
        if (dueDates.length > 0 && currentTime >= todayTime) {
            break;
        }

        // Advance
        currentDueDate = addDays(currentDueDate, intervalDays);

        // Safety: stay within 1 year
        if (isAfter(currentDueDate, addDays(todayObj, 366))) {
            break;
        }
    }

    return dueDates;
}

// ------------------------------------------------------------------
// MAIN FUNCTION
// ------------------------------------------------------------------

Deno.serve(async (req) => {
    // Handle CORS
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const url = new URL(req.url);
        const tokenParam = url.searchParams.get('token');
        const cronSecret = Deno.env.get('CRON_SECRET');

        // DEBUG LOGS
        console.log('🔍 Auth Debug:', {
            hasTokenParam: !!tokenParam,
            tokenLength: tokenParam?.length || 0,
            hasCronSecret: !!cronSecret,
            secretLength: cronSecret?.length || 0,
            tokensMatch: tokenParam === cronSecret,
            requestURL: url.pathname + url.search
        });

        // ONLY allow if token matches - remove Authorization header bypass entirely
        if (!tokenParam || !cronSecret || tokenParam !== cronSecret) {
            console.error('❌ Unauthorized access attempt');
            return new Response(
                JSON.stringify({
                    error: 'Unauthorized',
                    message: 'Valid token required'
                }),
                {
                    status: 401,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                }
            );
        }

        console.log('✅ Authorized via CRON_SECRET token');

        // Create Supabase client
        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        const supabase = createClient(supabaseUrl, supabaseKey)

        console.log("🔄 Starting daily payment auto-generation...")

        // 1. Fetch all active tenants
        const { data: tenants, error: tenantError } = await supabase
            .from('tenants')
            .select('*')
            .eq('is_active', true)
            .not('lease_start_date', 'is', null)

        if (tenantError) throw tenantError

        console.log(`👥 Found ${tenants.length} active tenants`)

        let totalCreated = 0
        const today = new Date()

        // 2. Process each tenant
        for (const tenant of tenants) {
            if (!tenant.rent_due_day || !tenant.rent_frequency || !tenant.weekly_rent) {
                console.warn(`⚠️ Skipping tenant ${tenant.first_name} ${tenant.last_name}: Missing rent details`)
                continue
            }

            // Fetch existing payments first to decide strategy
            const { data: existingPayments } = await supabase
                .from('payments')
                .select('due_date')
                .eq('tenant_id', tenant.id)

            // STRATEGY: 
            // 1. If payments exist: Resume standard generation (retroactive backfill allowed to close gaps)
            // 2. If NO payments (New Tenant): Only generate from TODAY onwards (prevent retroactive backfill)
            const generationStartDate = (existingPayments && existingPayments.length > 0)
                ? undefined // Default to leaseStartDate
                : today; // Start from today for new tenants

            // Calculate expected due dates
            const dueDates = calculateDueDates(
                tenant.lease_start_date,
                tenant.rent_frequency as "Weekly" | "Fortnightly",
                tenant.rent_due_day,
                today,
                generationStartDate
            )

            if (dueDates.length === 0) continue

            // Filter for new payments only (duplicates check)
            const existingDates = new Set(existingPayments?.map(p => p.due_date) || [])
            const newDueDates = dueDates.filter(d => !existingDates.has(d))

            if (newDueDates.length > 0) {
                // Create payment records
                const newPayments = newDueDates.map(date => {
                    console.log('💾 Creating payment record (Edge Function):', {
                        due_date: date,
                        amount: tenant.weekly_rent,
                        status: 'Unpaid',
                        tenant_id: tenant.id
                    });
                    return {
                        tenant_id: tenant.id,
                        property_id: tenant.property_id,
                        due_date: date,
                        amount: tenant.weekly_rent,
                        status: 'Unpaid'
                    };
                })

                const { error: insertError } = await supabase
                    .from('payments')
                    .insert(newPayments)

                if (insertError) {
                    console.error(`❌ Error inserting payments for ${tenant.first_name}:`, insertError)
                } else {
                    console.log(`✅ Created ${newPayments.length} payments for ${tenant.first_name} ${tenant.last_name}`)
                    totalCreated += newPayments.length
                }
            }
        }

        return new Response(
            JSON.stringify({
                message: 'Auto-generation complete',
                total_payments_created: totalCreated
            }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200,
            }
        )

    } catch (error) {
        console.error('❌ Error executing function:', error)
        return new Response(
            JSON.stringify({ error: error.message }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 500,
            }
        )
    }
})

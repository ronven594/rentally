// Simple client-side rate limiter to prevent abuse
interface RateLimitEntry {
    count: number;
    resetAt: number;
}

const rateLimits = new Map<string, RateLimitEntry>();

export function checkRateLimit(
    key: string,
    maxAttempts: number,
    windowMs: number
): { allowed: boolean; remainingAttempts: number; resetIn: number } {
    const now = Date.now();
    const entry = rateLimits.get(key);

    if (!entry || now > entry.resetAt) {
        // New window or expired
        rateLimits.set(key, { count: 1, resetAt: now + windowMs });
        return { allowed: true, remainingAttempts: maxAttempts - 1, resetIn: windowMs };
    }

    if (entry.count >= maxAttempts) {
        // Rate limit exceeded
        return {
            allowed: false,
            remainingAttempts: 0,
            resetIn: entry.resetAt - now
        };
    }

    // Increment count
    entry.count++;
    rateLimits.set(key, entry);

    return {
        allowed: true,
        remainingAttempts: maxAttempts - entry.count,
        resetIn: entry.resetAt - now
    };
}

// Clear old entries periodically
if (typeof window !== 'undefined') {
    setInterval(() => {
        const now = Date.now();
        for (const [key, entry] of rateLimits.entries()) {
            if (now > entry.resetAt) {
                rateLimits.delete(key);
            }
        }
    }, 60000); // Clean up every minute
}

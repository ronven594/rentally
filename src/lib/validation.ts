// Email validation
export function isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email) && email.length <= 320; // RFC 5321
}

// Password validation
export function isValidPassword(password: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (password.length < 12) {
        errors.push('Password must be at least 12 characters');
    }
    if (!/[a-z]/.test(password)) {
        errors.push('Password must contain lowercase letters');
    }
    if (!/[A-Z]/.test(password)) {
        errors.push('Password must contain uppercase letters');
    }
    if (!/[0-9]/.test(password)) {
        errors.push('Password must contain numbers');
    }
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
        errors.push('Password must contain special characters');
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

// Sanitize text input (prevent XSS)
export function sanitizeInput(input: string): string {
    return input
        .trim()
        .replace(/[<>]/g, '') // Remove angle brackets
        .substring(0, 500); // Limit length
}

// Validate phone number (NZ format)
export function isValidNZPhone(phone: string): boolean {
    // Accepts: 021 234 5678, 09 123 4567, +64 21 234 5678
    const phoneRegex = /^(\+64|0)[2-9]\d{7,9}$/;
    return phoneRegex.test(phone.replace(/\s/g, ''));
}

// Validate address
export function isValidAddress(address: string): boolean {
    return address.trim().length >= 10 && address.trim().length <= 200;
}

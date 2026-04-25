export function encodeSvg(svg: string): string {
    return `data:image/svg+xml;base64,${Buffer.from(svg.trim()).toString('base64')}`;
}

export function generateLoadingSvg(): string {
    return encodeSvg(`
        <svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
            <rect width="144" height="144" fill="#0a0a0a" />
            <circle cx="72" cy="72" r="40" fill="none" stroke="#333" stroke-width="6" />
            <circle cx="72" cy="72" r="40" fill="none" stroke="#666" stroke-width="6" stroke-dasharray="164.93" stroke-dashoffset="82.46">
                <animateTransform attributeName="transform" type="rotate" from="0 72 72" to="360 72 72" dur="1s" repeatCount="indefinite" />
            </circle>
        </svg>
    `);
}

export function generateMessageSvg(title: string, subtitle?: string, color: string = "#ef4444"): string {
    const lines = title.split('\\n');
    let textElements = '';
    
    if (lines.length === 1 && !subtitle) {
        textElements = `<text x="72" y="82" font-family="sans-serif" font-size="28" font-weight="bold" fill="${color}" text-anchor="middle">${lines[0]}</text>`;
    } else {
        const startY = 72 - ((lines.length - 1) * 15);
        lines.forEach((line, i) => {
            textElements += `<text x="72" y="${startY + (i * 30)}" font-family="sans-serif" font-size="24" font-weight="bold" fill="${color}" text-anchor="middle">${line}</text>`;
        });
    }

    if (subtitle) {
        textElements += `<text x="72" y="125" font-family="sans-serif" font-size="14" fill="#888" text-anchor="middle">${subtitle}</text>`;
    }

    return encodeSvg(`
        <svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
            <rect width="144" height="144" fill="#0a0a0a" />
            <circle cx="72" cy="72" r="58" fill="none" stroke="#222" stroke-width="4" stroke-dasharray="6 6" />
            ${textElements}
        </svg>
    `);
}

export function generatePercentageSvg(usagePercentage: number, label: string): string {
    const r = 48;
    const c = 2 * Math.PI * r;
    // 0% usage -> 100% filled, 100% usage -> 0% filled
    const remainingPercentage = Math.max(0, 100 - usagePercentage);
    const dash = (remainingPercentage / 100) * c;
    const gap = c;
    
    let color = "#10b981"; // Emerald (Good)
    if (usagePercentage >= 90) color = "#ef4444"; // Red (Critical)
    else if (usagePercentage >= 70) color = "#f59e0b"; // Amber (Warning)
    
    return encodeSvg(`
        <svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
            <rect width="144" height="144" fill="#0a0a0a" />
            <circle cx="72" cy="72" r="${r}" fill="none" stroke="#222" stroke-width="10" />
            ${remainingPercentage > 0 ? `<circle cx="72" cy="72" r="${r}" fill="none" stroke="${color}" stroke-width="10" 
                stroke-dasharray="${dash} ${gap}" stroke-dashoffset="0" stroke-linecap="round" 
                transform="rotate(-90 72 72)" />` : ""}
            <text x="72" y="84" font-family="sans-serif" font-size="34" font-weight="bold" fill="#fff" text-anchor="middle">${usagePercentage}%</text>
            <text x="72" y="132" font-family="sans-serif" font-size="14" font-weight="600" fill="#888" text-anchor="middle">${label}</text>
            <text x="72" y="24" font-family="sans-serif" font-size="12" font-weight="600" fill="#ccc" text-anchor="middle" letter-spacing="2">CLAUDE</text>
        </svg>
    `);
}

export function generateCountSvg(count: number, limit: number, label: string = "LEFT"): string {
    const percentage = limit > 0 ? Math.max(0, Math.min(100, (count / limit) * 100)) : 0;
    const r = 48;
    const c = 2 * Math.PI * r;
    const dash = (percentage / 100) * c;
    const gap = c;

    let color = "#3b82f6"; // Blue
    if (percentage <= 10) color = "#ef4444"; // Red (Critical)
    else if (percentage <= 30) color = "#f59e0b"; // Amber (Warning)

    return encodeSvg(`
        <svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
            <rect width="144" height="144" fill="#0a0a0a" />
            <circle cx="72" cy="72" r="${r}" fill="none" stroke="#222" stroke-width="10" />
            ${percentage > 0 ? `<circle cx="72" cy="72" r="${r}" fill="none" stroke="${color}" stroke-width="10" 
                stroke-dasharray="${dash} ${gap}" stroke-dashoffset="0" stroke-linecap="round" 
                transform="rotate(-90 72 72)" />` : ""}
            <text x="72" y="86" font-family="sans-serif" font-size="44" font-weight="bold" fill="#fff" text-anchor="middle">${count}</text>
            <text x="72" y="132" font-family="sans-serif" font-size="14" font-weight="600" fill="#888" text-anchor="middle">${label}</text>
            <text x="72" y="24" font-family="sans-serif" font-size="12" font-weight="600" fill="#ccc" text-anchor="middle" letter-spacing="1.5">COPILOT</text>
        </svg>
    `);
}

export function generateCreditSvg(amountInCents: number, currency: string, label: string = "CREDITS"): string {
    const dollars = (amountInCents / 100).toFixed(2);
    const prefix = currency === "USD" ? "$" : currency + " ";
    
    let color = "#10b981"; // Emerald (Good)
    if (amountInCents <= 500) color = "#ef4444"; // Red (Critical) < $5
    else if (amountInCents <= 1000) color = "#f59e0b"; // Amber (Warning) < $10
    
    return encodeSvg(`
        <svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
            <rect width="144" height="144" fill="#0a0a0a" />
            <circle cx="72" cy="72" r="48" fill="none" stroke="${color}" stroke-width="10" />
            <text x="72" y="86" font-family="sans-serif" font-size="32" font-weight="bold" fill="#fff" text-anchor="middle">${prefix}${dollars}</text>
            <text x="72" y="132" font-family="sans-serif" font-size="14" font-weight="600" fill="#888" text-anchor="middle">${label}</text>
            <text x="72" y="24" font-family="sans-serif" font-size="12" font-weight="600" fill="#ccc" text-anchor="middle" letter-spacing="1.5">CLAUDE</text>
        </svg>
    `);
}

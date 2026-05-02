export type DiffFormatOptions = {
    prefix?: string;
    suffix?: string;
    inverseColor?: boolean;
};

export class DiffTracker {
    private previousValues = new Map<string, number>();
    private lastDiffs = new Map<string, { diffStr?: string; diffColor?: string }>();

    public getDiff(actionId: string, currentValue: number, formatOptions?: DiffFormatOptions): { diffStr?: string; diffColor?: string } {
        const prev = this.previousValues.get(actionId);
        this.previousValues.set(actionId, currentValue);

        if (prev === undefined) {
            return {};
        }

        const delta = currentValue - prev;
        if (Math.abs(delta) < 0.01) {
            return this.lastDiffs.get(actionId) || {};
        }

        const isPositive = delta > 0;
        const color = formatOptions?.inverseColor 
            ? (isPositive ? "#ef4444" : "#10b981") // Red when increasing
            : (isPositive ? "#10b981" : "#ef4444"); // Green when increasing
        
        const absVal = Math.abs(delta);
        const valStr = formatOptions?.prefix === "$" ? absVal.toFixed(2) : absVal.toString();
        
        const diffData = {
            diffStr: `${isPositive ? "+" : "-"}${formatOptions?.prefix ?? ""}${valStr}${formatOptions?.suffix ?? ""}`,
            diffColor: color
        };
        
        this.lastDiffs.set(actionId, diffData);
        return diffData;
    }
}

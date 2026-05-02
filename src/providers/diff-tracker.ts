export type DiffFormatOptions = {
    prefix?: string;
    suffix?: string;
    inverseColor?: boolean;
};

export class DiffTracker {
    private previousValues = new Map<string, number>();

    public getDiff(actionId: string, currentValue: number, formatOptions?: DiffFormatOptions): { diffStr?: string; diffColor?: string } {
        const prev = this.previousValues.get(actionId);
        this.previousValues.set(actionId, currentValue);

        if (prev === undefined) {
            return {};
        }

        const delta = currentValue - prev;
        if (Math.abs(delta) < 0.01) {
            return {};
        }

        const isPositive = delta > 0;
        const color = formatOptions?.inverseColor 
            ? (isPositive ? "#ef4444" : "#10b981") // Red when increasing
            : (isPositive ? "#10b981" : "#ef4444"); // Green when increasing
        
        const absVal = Math.abs(delta);
        const valStr = formatOptions?.prefix === "$" ? absVal.toFixed(2) : absVal.toString();
        
        return {
            diffStr: `${isPositive ? "+" : "-"}${formatOptions?.prefix ?? ""}${valStr}${formatOptions?.suffix ?? ""}`,
            diffColor: color
        };
    }
}

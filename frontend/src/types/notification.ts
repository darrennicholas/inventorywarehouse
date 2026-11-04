export type NotificationPage = "purchases" | "sales" | "adjustments" | "transfers" | "expenses" | "payments" | "stock-report" | "purchase-returns" | "sales-returns" | "stock-opnames" | "fulfillment";
export type NotificationDestination = { page: NotificationPage; recordId: string; reference: string; warehouseId?: string };
export type NotificationTarget = NotificationDestination & { token: number };

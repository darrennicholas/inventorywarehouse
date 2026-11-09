const statusLabels: Record<string, string> = {
  ACTIVE: "Aktif", INACTIVE: "Tidak aktif", DRAFT: "Draf", REVISION: "Perlu revisi", PENDING: "Menunggu persetujuan", APPROVED: "Disetujui", REJECTED: "Ditolak", CANCELLED: "Dibatalkan", COMPLETED: "Selesai", POSTED: "Dibukukan", PARTIALLY_RECEIVED: "Diterima sebagian", RECEIVED: "Diterima", RESERVED: "Stok dipesan", PICKING: "Sedang diambil", PACKED: "Dikemas", PARTIALLY_SHIPPED: "Dikirim sebagian", SHIPPED: "Dikirim", IN_TRANSIT: "Dalam perjalanan", PAID: "Dibayar", UNPAID: "Belum dibayar", VOID: "Tidak berlaku", COUNTING: "Sedang dihitung", SUBMITTED: "Menunggu persetujuan", EXPIRED: "Kedaluwarsa", DEPLETED: "Habis", QUARANTINED: "Karantina", AVAILABLE: "Tersedia", SHORTAGE: "Kurang", OVERSTOCK: "Berlebih",
};

export function statusLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return statusLabels[value] ?? value.toLocaleLowerCase("id-ID").replaceAll("_", " ").replace(/(^|\s)\p{L}/gu, (letter) => letter.toLocaleUpperCase("id-ID"));
}

const actionLabels: Record<string, string> = {
  CREATE: "Dibuat", UPDATE: "Diubah", DELETE: "Dihapus", DEACTIVATE: "Dinonaktifkan", IMPORT: "Diimpor", APPROVE: "Disetujui", REJECT: "Ditolak", SUBMIT: "Diajukan", RESUBMIT: "Diajukan kembali", POST: "Dibukukan", RECEIVE: "Diterima", RESERVE: "Dipesan", CANCEL: "Dibatalkan", PICK: "Diambil", PACK: "Dikemas", SHIP: "Dikirim", COMPLETE: "Diselesaikan", VOID: "Dibatalkan", PAYMENT_STATE_SYNC: "Status pembayaran diselaraskan", PAYMENT_DUE_DATE: "Tanggal jatuh tempo diubah", PRICE_SNAPSHOT: "Harga dicatat", OPENING_COST: "Harga awal dicatat", SETTLE: "Settlement dicatat", REVERSE: "Settlement dibalik",
};

export function actionLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return actionLabels[value] ?? value.toLocaleLowerCase("id-ID").replaceAll("_", " ").replace(/(^|\s)\p{L}/gu, (letter) => letter.toLocaleUpperCase("id-ID"));
}
